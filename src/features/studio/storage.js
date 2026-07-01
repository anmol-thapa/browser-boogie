import { supabase } from "../../lib/supabaseClient";
import {
  RECORDINGS_BUCKET,
  SIGNED_URL_TTL_SEC,
  PERSIST_FILE_KEYS,
  PERSIST_JSON_KEYS,
  PERSIST_VALUE_KEYS,
} from "./constants";
import {
  makeFolderId,
  randomShareCode,
  statsRowToSummary,
  roundN,
  normalizeDifficulty,
  scoreToLetterGrade,
  presetMediaInfo,
} from "./utils";
import { DEFAULT_DIFFICULTY } from "./constants";

export async function getUserRecordingCount(userId) {
  const { count, error } = await supabase
    .from("folders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return 0;
  return count || 0;
}

export async function persistSessionBundleToDisk({ userId, sessionId, folderId, bundle }) {
  const targetFolderId = folderId || makeFolderId();

  const manifest = {
    version: 1,
    sessionId,
    files: {},
    values: {},
  };

  for (const key of PERSIST_FILE_KEYS) {
    const value = bundle[key];
    if (!(value instanceof File)) continue;
    const fileName = value.name || `${key}.bin`;
    manifest.files[key] = {
      name: fileName,
      kind: "binary",
      mime: value.type || "application/octet-stream",
    };
    const { error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .upload(`${userId}/${targetFolderId}/${fileName}`, value, {
        contentType: value.type || "application/octet-stream",
        upsert: true,
      });
    if (error) throw new Error(`save failed: ${error.message}`);
  }

  for (const key of PERSIST_JSON_KEYS) {
    const value = bundle[key];
    if (!value || typeof value !== "object") continue;
    const fileName = `${key}.json`;
    manifest.files[key] = {
      name: fileName,
      kind: "json",
      mime: "application/json",
    };
    const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
    const { error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .upload(`${userId}/${targetFolderId}/${fileName}`, blob, {
        contentType: "application/json",
        upsert: true,
      });
    if (error) throw new Error(`save failed: ${error.message}`);
  }

  for (const key of PERSIST_VALUE_KEYS) {
    if (bundle[key] == null) continue;
    manifest.values[key] = bundle[key];
  }

  const { error: upsertErr } = await supabase.from("folders").upsert({
    id: targetFolderId,
    user_id: userId,
    manifest,
    updated_at: new Date().toISOString(),
  });
  if (upsertErr) throw new Error(`save failed: ${upsertErr.message}`);

  return { ok: true, folderId: targetFolderId, manifest };
}

export async function decodeStoragePayloadToBundle(payload) {
  const manifest = payload?.manifest || {};
  const files = manifest.files || {};
  const values = manifest.values || {};
  const bundle = {};
  const missingKeys = [];

  const fileEntries = Object.entries(files);
  for (const [key, info] of fileEntries) {
    const url = info?.url;
    if (!url) {
      missingKeys.push(key);
      continue;
    }
    const fileResp = await fetch(url);
    if (!fileResp.ok) {
      missingKeys.push(key);
      continue;
    }
    if (info.kind === "json") {
      try {
        bundle[key] = await fileResp.json();
      } catch {
        missingKeys.push(key);
      }
      continue;
    }
    const blob = await fileResp.blob();
    bundle[key] = new File([blob], info.name || `${key}.bin`, {
      type: info.mime || blob.type || "application/octet-stream",
    });
  }

  for (const key of PERSIST_VALUE_KEYS) {
    if (values[key] != null) {
      bundle[key] = values[key];
    }
  }

  bundle.__hydrated = true;
  return { bundle, missingKeys };
}

async function manifestFilesToSignedUrls(manifestFiles, ownerUserId, folderId) {
  const files = {};
  for (const [key, meta] of Object.entries(manifestFiles || {})) {
    if (!meta?.name) continue;
    const { data, error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(`${ownerUserId}/${folderId}/${meta.name}`, SIGNED_URL_TTL_SEC);
    files[key] = { ...meta, url: error ? "" : data?.signedUrl || "" };
  }
  return files;
}

export async function loadSessionBundleFromDisk(folderId, userId) {
  const { data: row, error } = await supabase.from("folders").select("*").eq("id", folderId).maybeSingle();
  if (error || !row) {
    return { missing: true, bundle: null };
  }

  const manifest = row.manifest || {};
  const files = await manifestFilesToSignedUrls(manifest.files, row.user_id, folderId);
  const decoded = await decodeStoragePayloadToBundle({ manifest: { ...manifest, files } });
  return {
    missing: false,
    missingKeys: decoded.missingKeys,
    bundle: decoded.bundle,
  };
}

export async function loadSessionBundleFromShareCode(code) {
  const normalized = String(code || "").trim();
  if (!normalized) {
    return { missing: true, bundle: null, sharedCode: "", folderId: "" };
  }

  const { data, error } = await supabase.rpc("get_shared_folder", { share_code: normalized });
  const row = Array.isArray(data) ? data[0] : null;
  if (error) {
    throw new Error(`share load failed: ${error.message}`);
  }
  if (!row) {
    return { missing: true, bundle: null, sharedCode: normalized, folderId: "" };
  }

  const manifest = row.manifest || {};
  const stripWebcam = Boolean(row.strip_webcam);
  const manifestFiles = stripWebcam
    ? Object.fromEntries(Object.entries(manifest.files || {}).filter(([k]) => k !== "recordedWebcamFile" && k !== "loadWebcamVideoFile"))
    : (manifest.files || {});
  const files = await manifestFilesToSignedUrls(manifestFiles, row.user_id, row.id);
  const decoded = await decodeStoragePayloadToBundle({ manifest: { ...manifest, files } });
  return {
    missing: false,
    missingKeys: decoded.missingKeys,
    bundle: decoded.bundle,
    sharedCode: normalized,
    folderId: String(row.id || ""),
    ownerUserId: String(row.user_id || ""),
  };
}

export async function createShareCode(folderId, userId, { stripWebcam = false } = {}) {
  await supabase.from("shares").delete().eq("folder_id", folderId);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = randomShareCode();
    const { error } = await supabase.from("shares").insert({
      code,
      folder_id: folderId,
      created_by: userId || null,
      strip_webcam: stripWebcam,
    });
    if (!error) return { code, folderId };
    if (error.code !== "23505") throw new Error(`share create failed: ${error.message}`);
  }
  throw new Error("share create failed: could not generate a unique code");
}

export async function fetchBrowseSelections() {
  const { data, error } = await supabase.rpc("list_public_presets");
  if (error) throw new Error(`browse list failed: ${error.message}`);
  return (data || []).map((row) => {
    const manifest = row.manifest || {};
    const media = presetMediaInfo(manifest.files);
    return {
      id: row.id,
      title: row.title || row.id,
      description: row.description || "",
      category: row.category || "General",
      tags: Array.isArray(row.tags) ? row.tags : [],
      difficulty: row.difficulty || DEFAULT_DIFFICULTY,
      durationSec: Number(manifest?.values?.durationSec) || 0,
      ...media,
    };
  });
}

export async function loadBrowseSelection(selectionId) {
  const normalized = String(selectionId || "").trim();
  if (!normalized) {
    throw new Error("Selection is missing an id.");
  }
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("id", normalized)
    .eq("is_public", true)
    .maybeSingle();
  if (error) throw new Error(`browse load failed: ${error.message}`);
  if (!data) throw new Error("Selection was not found.");

  const manifest = data.manifest || {};
  const files = await manifestFilesToSignedUrls(manifest.files, data.user_id, normalized);
  return { manifest: { ...manifest, files } };
}

export async function fetchUserStatsSummary(userId) {
  const { data, error } = await supabase.from("user_stats").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`stats summary failed: ${error.message}`);
  return statsRowToSummary(data, userId, "Dancer");
}

export async function recordPracticeStats(userProfile, run) {
  const userId = userProfile?.userId;
  const displayName = userProfile?.displayName || "Dancer";
  const recordedAt = new Date().toISOString();
  const runRecord = {
    id: Math.random().toString(16).slice(2, 14),
    sessionId: String(run?.sessionId || ""),
    sessionTitle: String(run?.sessionTitle || "Practice"),
    averageScore: roundN(Number(run?.averageScore) || 0, 2),
    bestScore: roundN(Number(run?.bestScore) || 0, 2),
    samples: Number(run?.samples) || 0,
    durationSec: roundN(Number(run?.durationSec) || 0, 2),
    grade: scoreToLetterGrade(Number(run?.averageScore) || 0),
    source: String(run?.source || "play"),
    sessionSource: String(run?.sessionSource || ""),
    difficulty: normalizeDifficulty(run?.difficulty, DEFAULT_DIFFICULTY),
    endedAt: recordedAt,
  };

  // Fetch-then-upsert is not atomic; two concurrent run submissions from the same
  // user could race. Acceptable for a single-user-at-a-time practice flow.
  const { data: existing, error: fetchErr } = await supabase
    .from("user_stats")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchErr) throw new Error(`stats record failed: ${fetchErr.message}`);

  const priorRuns = Array.isArray(existing?.runs) ? existing.runs : [];
  const nextRuns = [...priorRuns, runRecord].slice(-200);
  const nextRow = {
    user_id: userId,
    display_name: displayName,
    runs: nextRuns,
    total_runs: (Number(existing?.total_runs) || 0) + 1,
    sum_average: Number(existing?.sum_average || 0) + runRecord.averageScore,
    best_score: Math.max(Number(existing?.best_score) || 0, runRecord.bestScore),
    last_run_at: recordedAt,
  };

  const { error: upsertErr } = await supabase.from("user_stats").upsert(nextRow);
  if (upsertErr) throw new Error(`stats record failed: ${upsertErr.message}`);

  const summary = await fetchUserStatsSummary(userId);
  return { userSummary: summary, recordedRun: runRecord };
}
