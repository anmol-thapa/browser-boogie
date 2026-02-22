import React, { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "justdance_frontend_test_sessions_v2";

const MODE_OPTIONS = [
  { id: "record", label: "Recording Session", hint: "Create a routine from webcam recording." },
  { id: "load-routine", label: "Play Session", hint: "Load a routine package and start practicing." },
  { id: "create-video", label: "Create From Video", hint: "Generate a routine from an uploaded dance video." },
];

const WEBCAM_LAYOUT_OPTIONS = [
  { id: "raw", label: "Raw Webcam" },
  { id: "side-by-side", label: "Side-By-Side" },
];

const MODEL_PATH = "/pose_landmarker.task";
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19], [12, 14],
  [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [11, 23], [12, 24], [23, 24],
  [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32],
  [27, 31], [28, 32],
];

function nativeImport(moduleUrl) {
  return Function("u", "return import(u)")(moduleUrl);
}

function drawPoseSkeleton(ctx, landmarks, width, height, color = "#34d399") {
  if (!landmarks || !Array.isArray(landmarks)) return;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  for (const [s, e] of POSE_CONNECTIONS) {
    const p1 = landmarks[s];
    const p2 = landmarks[e];
    if (!p1 || !p2) continue;
    ctx.beginPath();
    ctx.moveTo(p1.x * width, p1.y * height);
    ctx.lineTo(p2.x * width, p2.y * height);
    ctx.stroke();
  }

  for (const p of landmarks) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const LEFT_KNEE = 25;
const RIGHT_KNEE = 26;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

function roundN(v, digits) {
  const scale = Math.pow(10, digits);
  return Math.round(Number(v) * scale) / scale;
}

function angleDegrees2d(a, b, c) {
  if (!a || !b || !c) return null;
  const bax = a[0] - b[0];
  const bay = a[1] - b[1];
  const bcx = c[0] - b[0];
  const bcy = c[1] - b[1];
  const denom = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (!Number.isFinite(denom) || denom < 1e-9) return null;
  let cosTheta = (bax * bcx + bay * bcy) / denom;
  cosTheta = Math.max(-1, Math.min(1, cosTheta));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

function extractAnglesFromLm2d(lm2d) {
  if (!Array.isArray(lm2d) || lm2d.length < 33) return {};
  const angles = {};

  function addAngle(name, a, b, c) {
    const value = angleDegrees2d(lm2d[a], lm2d[b], lm2d[c]);
    if (value != null && Number.isFinite(value)) {
      angles[name] = roundN(value, 3);
    }
  }

  addAngle("lElbow", LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST);
  addAngle("rElbow", RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST);
  addAngle("lShoulder", LEFT_ELBOW, LEFT_SHOULDER, LEFT_HIP);
  addAngle("rShoulder", RIGHT_ELBOW, RIGHT_SHOULDER, RIGHT_HIP);
  addAngle("lKnee", LEFT_HIP, LEFT_KNEE, LEFT_ANKLE);
  addAngle("rKnee", RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE);
  return angles;
}

function lm2dToLandmarks(lm2d) {
  if (!Array.isArray(lm2d)) return null;
  return lm2d.map((p) => ({ x: Number(p?.[0]) || 0, y: Number(p?.[1]) || 0 }));
}

function buildRoutinePayload(name, frames) {
  const safeFrames = Array.isArray(frames) ? frames : [];
  const durationSec = safeFrames.length > 0 ? Number(safeFrames[safeFrames.length - 1].t) || 0 : 0;
  const fps =
    safeFrames.length >= 2 && durationSec > 0
      ? roundN((safeFrames.length - 1) / durationSec, 2)
      : 30;

  return {
    version: 1,
    name: name || "User Routine",
    fps,
    durationSec: roundN(durationSec, 3),
    song: { title: "Unknown Track", offsetSec: 0 },
    frames: safeFrames.map((frame) => ({
      t: roundN(Number(frame.t) || 0, 3),
      lm2d: Array.isArray(frame.lm2d)
        ? frame.lm2d.map((p) => [roundN(Number(p?.[0]) || 0, 6), roundN(Number(p?.[1]) || 0, 6)])
        : [],
      angles: frame.angles && typeof frame.angles === "object" ? frame.angles : {},
    })),
  };
}

function nearestFrameAtTime(routine, tSec, windowSec = 0.25) {
  if (!routine || !Array.isArray(routine.frames) || routine.frames.length === 0) return null;
  let best = null;
  let bestDt = Infinity;
  for (const frame of routine.frames) {
    const dt = Math.abs((Number(frame.t) || 0) - tSec);
    if (dt <= windowSec && dt < bestDt) {
      best = frame;
      bestDt = dt;
    }
  }
  return best;
}

const SCORE_POINT_IDS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

function lm2dAt(lm2d, idx) {
  const p = lm2d?.[idx];
  if (!Array.isArray(p) || p.length < 2) return null;
  const x = Number(p[0]);
  const y = Number(p[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function distance2d(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function normalizeLm2dForScore(lm2d) {
  if (!Array.isArray(lm2d) || lm2d.length < 29) return null;
  const lShoulder = lm2dAt(lm2d, LEFT_SHOULDER);
  const rShoulder = lm2dAt(lm2d, RIGHT_SHOULDER);
  const lHip = lm2dAt(lm2d, LEFT_HIP);
  const rHip = lm2dAt(lm2d, RIGHT_HIP);
  if (!lShoulder || !rShoulder || !lHip || !rHip) return null;

  const shoulderMid = [(lShoulder[0] + rShoulder[0]) / 2, (lShoulder[1] + rShoulder[1]) / 2];
  const hipMid = [(lHip[0] + rHip[0]) / 2, (lHip[1] + rHip[1]) / 2];
  const center = [(shoulderMid[0] + hipMid[0]) / 2, (shoulderMid[1] + hipMid[1]) / 2];

  const shoulderSpan = distance2d(lShoulder, rShoulder);
  const hipSpan = distance2d(lHip, rHip);
  const torsoLen = distance2d(shoulderMid, hipMid);
  const scale = Math.max(shoulderSpan, hipSpan, torsoLen * 1.6, 1e-4);

  const out = {};
  for (const id of SCORE_POINT_IDS) {
    const p = lm2dAt(lm2d, id);
    if (!p) continue;
    out[id] = [(p[0] - center[0]) / scale, (p[1] - center[1]) / scale];
  }
  return out;
}

function poseSimilarityPercent(refLm2d, liveLm2d) {
  const refNorm = normalizeLm2dForScore(refLm2d);
  const liveNorm = normalizeLm2dForScore(liveLm2d);
  if (!refNorm || !liveNorm) return null;
  let totalDist = 0;
  let count = 0;
  for (const id of SCORE_POINT_IDS) {
    const a = refNorm[id];
    const b = liveNorm[id];
    if (!a || !b) continue;
    totalDist += distance2d(a, b);
    count += 1;
  }
  if (count < 6) return null;
  const avgDist = totalDist / count;
  const similarity = Math.exp(-1.85 * avgDist);
  return Math.max(0, Math.min(100, similarity * 100));
}

function angleSimilarityPercent(refAngles, liveAngles) {
  if (!refAngles || !liveAngles) return null;
  const keys = ["lElbow", "rElbow", "lShoulder", "rShoulder", "lKnee", "rKnee"];
  let total = 0;
  let count = 0;
  for (const key of keys) {
    const ref = Number(refAngles[key]);
    const live = Number(liveAngles[key]);
    if (!Number.isFinite(ref) || !Number.isFinite(live)) continue;
    const diff = Math.abs(ref - live);
    const similarity = Math.max(0, 1 - diff / 75);
    total += similarity;
    count += 1;
  }
  if (count < 3) return null;
  return (total / count) * 100;
}

function computeFrameScorePercent(referenceFrame, liveLandmarks) {
  if (!referenceFrame?.lm2d || !Array.isArray(liveLandmarks) || liveLandmarks.length < 29) return null;
  const liveLm2d = liveLandmarks.map((p) => [Number(p?.x) || 0, Number(p?.y) || 0]);
  const refAngles = referenceFrame.angles && typeof referenceFrame.angles === "object"
    ? referenceFrame.angles
    : extractAnglesFromLm2d(referenceFrame.lm2d);
  const liveAngles = extractAnglesFromLm2d(liveLm2d);

  const poseScore = poseSimilarityPercent(referenceFrame.lm2d, liveLm2d);
  const angleScore = angleSimilarityPercent(refAngles, liveAngles);

  if (poseScore == null && angleScore == null) return null;
  if (poseScore == null) return angleScore;
  if (angleScore == null) return poseScore;
  return 0.55 * angleScore + 0.45 * poseScore;
}

function modeLabel(mode) {
  return MODE_OPTIONS.find((item) => item.id === mode)?.label || mode;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function defaultImportDraft() {
  return {
    title: "",
    importMode: "load-package",
    loadZipFileName: "",
    loadZipFile: null,
    sourceVideoFileName: "",
    sourceVideoFile: null,
    friendShareCode: "",
  };
}

function loadStoredSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sessionTitleFromMode(mode) {
  if (mode === "record") return "New Recording";
  if (mode === "load-routine") return "Play Session";
  if (mode === "create-video") return "Video Conversion";
  return "Studio Session";
}

function importValidationError(draft) {
  if (draft.importMode === "load-package") {
    if (!draft.loadZipFile) return "Load package requires a zip file.";
    if (!draft.loadZipFileName.toLowerCase().endsWith(".zip")) return "Package file must be a .zip file.";
  }
  if (draft.importMode === "load-video") {
    if (!draft.sourceVideoFile) return "Load from video requires a video file.";
  }
  if (draft.importMode === "friend-code") {
    if (!String(draft.friendShareCode || "").trim()) return "Friend's video requires a share code.";
  }
  return "";
}

function basename(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || "";
}

function sanitizeFilename(name) {
  const cleaned = String(name || "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "file";
}

function safeRoutineName(name) {
  return String(name || "routine")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "routine";
}

function isLikelyAudioFileName(name) {
  return /\.(mp3|wav|m4a|ogg|aac|flac|mp4|mov|webm|m4v)$/i.test(String(name || ""));
}

function isLikelyVideoFileName(name) {
  return /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(String(name || ""));
}

let sharedImportVisionPromise = null;

async function getImportVisionRuntime() {
  if (sharedImportVisionPromise) return sharedImportVisionPromise;
  sharedImportVisionPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await nativeImport(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
    );
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    return { PoseLandmarker, vision };
  })();
  return sharedImportVisionPromise;
}

async function createImportPoseLandmarker() {
  const { PoseLandmarker, vision } = await getImportVisionRuntime();
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

function waitForMediaEvent(node, eventName) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`Media event failed: ${eventName}`));
    };
    const cleanup = () => {
      node.removeEventListener(eventName, onOk);
      node.removeEventListener("error", onErr);
    };
    node.addEventListener(eventName, onOk, { once: true });
    node.addEventListener("error", onErr, { once: true });
  });
}

async function seekVideoTo(video, tSec) {
  const safeT = Math.max(0, Math.min(tSec, Number(video.duration) || tSec));
  if (Math.abs((video.currentTime || 0) - safeT) < 0.002) return;
  video.currentTime = safeT;
  await waitForMediaEvent(video, "seeked");
}

async function buildRoutineFromVideoFile(videoFile, routineName, onProgress) {
  const landmarker = await createImportPoseLandmarker();
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;

  const objectUrl = URL.createObjectURL(videoFile);
  video.src = objectUrl;
  try {
    await waitForMediaEvent(video, "loadedmetadata");
    const duration = Number(video.duration) || 0;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0) {
      throw new Error("Invalid video metadata.");
    }

    const sampleFps = 15;
    const stepSec = 1 / sampleFps;
    const totalSamples = Math.max(1, Math.ceil(duration * sampleFps));
    const frames = [];
    let lastTimestampMs = -1;

    for (let i = 0; i < totalSamples; i += 1) {
      const tSec = Math.min(duration, i * stepSec);
      await seekVideoTo(video, tSec);
      const rawTimestampMs = Math.round(tSec * 1000);
      const timestampMs = rawTimestampMs <= lastTimestampMs ? lastTimestampMs + 1 : rawTimestampMs;
      lastTimestampMs = timestampMs;
      const result = landmarker.detectForVideo(video, timestampMs);
      const landmarks = result?.landmarks?.[0] || null;
      if (landmarks) {
        const lm2d = landmarks.map((p) => [roundN(p.x, 6), roundN(p.y, 6)]);
        frames.push({
          t: roundN(tSec, 3),
          lm2d,
          angles: extractAnglesFromLm2d(lm2d),
        });
      }
      if (onProgress && (i % 12 === 0 || i === totalSamples - 1)) {
        onProgress(i + 1, totalSamples);
      }
    }

    if (!frames.length) {
      throw new Error("No person found in video.");
    }

    const routine = buildRoutinePayload(routineName, frames);
    routine.durationSec = roundN(duration, 3);
    return routine;
  } finally {
    try {
      if (landmarker && typeof landmarker.close === "function") {
        landmarker.close();
      }
    } catch {
      // Ignore cleanup errors for import-only landmarker instances.
    }
    URL.revokeObjectURL(objectUrl);
  }
}

const PERSIST_FILE_KEYS = [
  "recordAudioFile",
  "loadZipFile",
  "createVideoFile",
  "playAudioFile",
  "loadAudioFile",
  "recordedWebcamFile",
  "loadWebcamVideoFile",
];

const PERSIST_JSON_KEYS = ["generatedRoutine", "loadedRoutine"];
const PERSIST_VALUE_KEYS = ["hideQuickSetup", "recordedWebcamLayout"];

function hasPersistableContent(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  return [...PERSIST_FILE_KEYS, ...PERSIST_JSON_KEYS, ...PERSIST_VALUE_KEYS].some((key) => {
    const value = bundle[key];
    if (value == null) return false;
    if (value instanceof File) return true;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return String(value).length > 0;
  });
}

async function persistSessionBundleToDisk({ sessionId, folderId, bundle }) {
  const form = new FormData();
  if (folderId) form.append("folder_id", folderId);

  const manifest = {
    version: 1,
    sessionId,
    files: {},
    values: {},
  };

  for (const key of PERSIST_FILE_KEYS) {
    const value = bundle[key];
    if (!(value instanceof File)) continue;
    manifest.files[key] = {
      name: value.name || `${key}.bin`,
      kind: "binary",
      mime: value.type || "application/octet-stream",
    };
    form.append(`file__${key}`, value, value.name || `${key}.bin`);
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
    form.append(`file__${key}`, blob, fileName);
  }

  for (const key of PERSIST_VALUE_KEYS) {
    if (bundle[key] == null) continue;
    manifest.values[key] = bundle[key];
  }

  form.append("manifest", JSON.stringify(manifest));

  const response = await fetch("/api/storage/save", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`save failed: ${response.status}`);
  }
  return response.json();
}

async function decodeStoragePayloadToBundle(payload) {
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
  return {
    bundle,
    missingKeys,
  };
}

async function loadSessionBundleFromDisk(folderId) {
  const response = await fetch(`/api/storage/load/${encodeURIComponent(folderId)}`);
  if (response.status === 404) {
    return { missing: true, bundle: null };
  }
  if (!response.ok) {
    throw new Error(`load failed: ${response.status}`);
  }

  const payload = await response.json();
  const decoded = await decodeStoragePayloadToBundle(payload);
  return {
    missing: false,
    missingKeys: decoded.missingKeys,
    bundle: decoded.bundle,
  };
}

async function loadSessionBundleFromShareCode(code) {
  const normalized = String(code || "").trim();
  if (!normalized) {
    return { missing: true, bundle: null, sharedCode: "", folderId: "" };
  }
  const response = await fetch(`/api/share/load/${encodeURIComponent(normalized)}`);
  if (response.status === 404) {
    return { missing: true, bundle: null, sharedCode: normalized, folderId: "" };
  }
  if (!response.ok) {
    if (response.status === 400) {
      throw new Error("Invalid share code.");
    }
    if (response.status === 500) {
      throw new Error("Share API failed on server.");
    }
    if (response.status === 501 || response.status === 405 || response.status === 404) {
      throw new Error("Share API unavailable. Restart backend with `python app.py`.");
    }
    throw new Error(`share load failed: ${response.status}`);
  }
  const payload = await response.json();
  const decoded = await decodeStoragePayloadToBundle(payload);
  return {
    missing: false,
    missingKeys: decoded.missingKeys,
    bundle: decoded.bundle,
    sharedCode: String(payload?.sharedCode || normalized),
    folderId: String(payload?.folderId || ""),
  };
}

async function createShareCode(folderId, sessionId) {
  const response = await fetch("/api/share/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folderId,
      sessionId,
    }),
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      throw new Error("Share API unavailable. Restart backend with `python app.py`.");
    }
    throw new Error(`share create failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.code) {
    throw new Error("share create failed: missing code");
  }
  return payload;
}

function isShareableSession(session) {
  if (!session) return false;
  return session.mode === "load-routine" || session.status === "ready" || session.status === "completed";
}

function deriveSessionConfigFromBundle(bundle = {}) {
  const routine =
    (bundle.loadedRoutine && typeof bundle.loadedRoutine === "object" ? bundle.loadedRoutine : null) ||
    (bundle.generatedRoutine && typeof bundle.generatedRoutine === "object" ? bundle.generatedRoutine : null);
  const zipName = bundle.loadZipFile?.name || "";
  const title = routine?.name || basename(zipName).replace(/\.zip$/i, "") || "Friend Session";
  const config = {
    packageZipFileName: zipName || `${safeRoutineName(title)}-package.zip`,
    requiredContents: ["routine.json", "audio/video source"],
    optionalContents: ["webcam video"],
  };
  return { title, config };
}

function mergeSessionConfig(currentConfig, patchConfig) {
  return {
    ...(currentConfig && typeof currentConfig === "object" ? currentConfig : {}),
    ...(patchConfig && typeof patchConfig === "object" ? patchConfig : {}),
  };
}

function buildSessionFromDraft(draft) {
  const now = new Date().toISOString();
  const sessionId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const base = {
    id: sessionId,
    title: draft.title.trim() || sessionTitleFromMode(draft.mode),
    mode: draft.mode,
    createdAt: now,
    updatedAt: now,
    runs: 0,
    lastRunSec: 0,
    status: "draft",
    countdownSec: draft.mode === "record" ? 3 : null,
    config: {},
  };

  if (draft.mode === "record") {
    base.config = {
      audioFileName: draft.recordAudioFileName,
      includeWebcamVideo: Boolean(draft.recordIncludeWebcamVideo),
      webcamLayout: draft.recordIncludeWebcamVideo ? draft.recordWebcamLayout : null,
    };
  } else if (draft.mode === "load-routine") {
    base.config = {
      packageZipFileName: draft.loadZipFileName,
      requiredContents: ["routine.json", "audio/video source"],
      optionalContents: ["webcam video"],
    };
  } else if (draft.mode === "create-video") {
    base.config = {
      videoFileName: draft.createVideoFileName,
    };
  }

  return base;
}

function describeSessionConfig(session) {
  if (session.mode === "record") {
    const webcam = session.config.includeWebcamVideo
      ? `Webcam: ${session.config.webcamLayout === "side-by-side" ? "Side-By-Side" : "Raw"}`
      : "Webcam: none";
    return `Audio: ${session.config.audioFileName || "none"} | ${webcam}`;
  }
  if (session.mode === "load-routine") {
    const base = `Play Package: ${session.config.packageZipFileName} (needs routine.json + audio)`;
    if (session.config?.shareCode) {
      return `${base} | Share: ${session.config.shareCode}`;
    }
    return base;
  }
  if (session.mode === "create-video") {
    return `Video: ${session.config.videoFileName}`;
  }
  return "";
}

function StudioWorkspace({ onLogout }) {
  const [view, setView] = useState("main");
  const [mainTab, setMainTab] = useState("dashboard");
  const [sessions, setSessions] = useState(loadStoredSessions);
  const [sessionFiles, setSessionFiles] = useState({});
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [shareModal, setShareModal] = useState({ open: false, code: "", title: "" });
  const [importDraft, setImportDraft] = useState(defaultImportDraft);
  const persistTimersRef = useRef({});
  const storageWarningShownRef = useRef(false);
  const folderIdBySessionRef = useRef({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    const next = {};
    for (const session of sessions) {
      if (session.dataFolderId) {
        next[session.id] = session.dataFolderId;
      }
    }
    folderIdBySessionRef.current = next;
  }, [sessions]);

  useEffect(() => {
    return () => {
      for (const t of Object.values(persistTimersRef.current)) {
        clearTimeout(t);
      }
    };
  }, []);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );
  const activeSessionFileBundle = activeSessionId ? sessionFiles[activeSessionId] || {} : {};

  function markStorageLink(sessionId, folderId) {
    if (!folderId) return;
    folderIdBySessionRef.current[sessionId] = folderId;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            dataFolderId: folderId,
          }
          : session
      )
    );
  }

  function schedulePersistSessionFiles(sessionId, bundle) {
    if (!hasPersistableContent(bundle)) return;
    const session = sessions.find((s) => s.id === sessionId);
    const existingFolderId = folderIdBySessionRef.current[sessionId] || session?.dataFolderId || "";
    const existingTimer = persistTimersRef.current[sessionId];
    if (existingTimer) clearTimeout(existingTimer);
    persistTimersRef.current[sessionId] = setTimeout(async () => {
      try {
        const result = await persistSessionBundleToDisk({
          sessionId,
          folderId: existingFolderId,
          bundle,
        });
        if (result?.folderId) {
          markStorageLink(sessionId, result.folderId);
        }
      } catch (err) {
        if (!storageWarningShownRef.current) {
          storageWarningShownRef.current = true;
          console.warn("Local data persistence unavailable. Start from `python app.py` to persist session files.", err);
        }
      }
    }, 200);
  }

  const metrics = useMemo(() => {
    const total = sessions.length;
    const completed = sessions.filter((s) => s.status === "completed" || s.status === "ready").length;
    const recording = sessions.filter((s) => s.mode === "record").length;
    const loading = sessions.filter((s) => s.mode === "load-routine").length;
    const fromVideo = sessions.filter((s) => s.mode === "create-video").length;
    return { total, completed, recording, loading, fromVideo };
  }, [sessions]);

  function openImportModal(initialMode = "load-package") {
    setImportDraft((prev) => ({
      ...defaultImportDraft(),
      importMode: initialMode,
      title: prev?.title || "",
    }));
    setShowImportModal(true);
  }

  function closeImportModal() {
    setShowImportModal(false);
  }

  function closeShareModal() {
    setShareModal({ open: false, code: "", title: "" });
  }

  async function openSessionInStudio(sessionId) {
    const targetSession = sessions.find((session) => session.id === sessionId);
    if (targetSession?.dataFolderId && !sessionFiles[sessionId]?.__hydrated) {
      try {
        const loadResult = await loadSessionBundleFromDisk(targetSession.dataFolderId);
        if (loadResult.missing) {
          window.alert("Session data folder was deleted or moved. Re-import files for this session.");
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? {
                  ...session,
                  status: "missing-data",
                }
                : session
            )
          );
        } else if (loadResult.bundle) {
          setSessionFiles((prev) => ({
            ...prev,
            [sessionId]: {
              ...(prev[sessionId] || {}),
              ...loadResult.bundle,
            },
          }));
          if (loadResult.missingKeys?.length) {
            window.alert(`Some files are missing for this session: ${loadResult.missingKeys.join(", ")}`);
          }
        }
      } catch (err) {
        console.error("Failed to hydrate session files:", err);
      }
    }

    setActiveSessionId(sessionId);
    setView("studio");
  }

  async function ensureShareFolderId(sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return "";
    let folderId = folderIdBySessionRef.current[sessionId] || session.dataFolderId || "";
    if (folderId) return folderId;

    const bundle = sessionFiles[sessionId] || {};
    if (!hasPersistableContent(bundle)) {
      return "";
    }

    const result = await persistSessionBundleToDisk({
      sessionId,
      folderId: "",
      bundle,
    });
    folderId = String(result?.folderId || "");
    if (folderId) {
      markStorageLink(sessionId, folderId);
    }
    return folderId;
  }

  function addSessionAndOpen(session, files = {}) {
    if (session?.dataFolderId) {
      folderIdBySessionRef.current[session.id] = session.dataFolderId;
    }
    setSessions((prev) => [session, ...prev]);
    setSessionFiles((prev) => ({
      ...prev,
      [session.id]: {
        ...files,
      },
    }));
    schedulePersistSessionFiles(session.id, files);
    setActiveSessionId(session.id);
    setView("studio");
    return session.id;
  }

  function startRecordSession() {
    const session = buildSessionFromDraft({
      title: "",
      mode: "record",
      recordAudioFileName: "",
      recordIncludeWebcamVideo: false,
      recordWebcamLayout: "raw",
      loadZipFileName: "",
      createVideoFileName: "",
    });
    addSessionAndOpen(session, { recordAudioFile: null });
  }

  async function submitImportSession(draft, setProgress) {
    const err = importValidationError(draft);
    if (err) throw new Error(err);

    if (draft.importMode === "load-package") {
      const session = buildSessionFromDraft({
        title: draft.title || "",
        mode: "load-routine",
        recordAudioFileName: "",
        recordIncludeWebcamVideo: false,
        recordWebcamLayout: "raw",
        loadZipFileName: draft.loadZipFileName,
        createVideoFileName: "",
      });
      addSessionAndOpen(session, { loadZipFile: draft.loadZipFile || null });
      closeImportModal();
      return;
    }

    if (draft.importMode === "friend-code") {
      const code = String(draft.friendShareCode || "").trim().toUpperCase();
      setProgress("Resolving friend's shared session...");
      const loadResult = await loadSessionBundleFromShareCode(code);
      if (loadResult.missing || !loadResult.bundle) {
        throw new Error("Share code not found. Ask your friend to share again.");
      }

      const bundle = loadResult.bundle;
      const { title: inferredTitle, config } = deriveSessionConfigFromBundle(bundle);
      const sessionTitle = draft.title.trim() || inferredTitle || `Friend Session ${code}`;

      const session = buildSessionFromDraft({
        title: sessionTitle,
        mode: "load-routine",
        recordAudioFileName: "",
        recordIncludeWebcamVideo: false,
        recordWebcamLayout: "raw",
        loadZipFileName: bundle.loadZipFile?.name || config.packageZipFileName || "",
        createVideoFileName: "",
      });
      session.status = "ready";
      session.countdownSec = null;
      session.config = mergeSessionConfig(session.config, {
        ...config,
        source: "friend-share",
        shareCode: code,
      });
      if (loadResult.folderId) {
        session.dataFolderId = loadResult.folderId;
      }

      addSessionAndOpen(session, {
        ...bundle,
        __hydrated: true,
      });
      closeImportModal();
      return;
    }

    const sourceVideo = draft.sourceVideoFile;
    const guessedName = draft.title.trim() || basename(draft.sourceVideoFileName).replace(/\.[^.]+$/, "") || "Video Routine";
    setProgress("Analyzing video and extracting pose frames...");
    const routine = await buildRoutineFromVideoFile(sourceVideo, guessedName, (done, total) => {
      const pct = Math.round((done / Math.max(1, total)) * 100);
      setProgress(`Analyzing video... ${pct}%`);
    });
    setProgress("Preparing routine package...");

    const packageName = `${safeRoutineName(guessedName)}-package.zip`;
    const sourceName = sanitizeFilename(sourceVideo?.name || `${safeRoutineName(guessedName)}.mp4`);
    const routineExport = {
      ...routine,
      song: {
        ...(routine.song || {}),
        offsetSec: Number(routine.song?.offsetSec) || 0,
        fileName: sourceName,
      },
      webcam: {
        fileName: sourceName,
        layout: "side-by-side",
      },
    };
    const JSZip = (await nativeImport("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
    const zip = new JSZip();
    zip.file("routine.json", JSON.stringify(routineExport, null, 2));
    zip.file(sourceName, sourceVideo);
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const packageFile = new File([zipBlob], packageName, { type: "application/zip" });

    setProgress("Preparing play session...");
    const session = buildSessionFromDraft({
      title: guessedName,
      mode: "load-routine",
      recordAudioFileName: "",
      recordIncludeWebcamVideo: false,
      recordWebcamLayout: "raw",
      loadZipFileName: packageName,
      createVideoFileName: "",
    });
    session.status = "ready";
    session.countdownSec = null;

    addSessionAndOpen(session, {
      loadedRoutine: routineExport,
      generatedRoutine: routineExport,
      playAudioFile: sourceVideo,
      loadWebcamVideoFile: sourceVideo,
      recordedWebcamLayout: "side-by-side",
      createVideoFile: sourceVideo,
      loadZipFile: packageFile,
    });
    closeImportModal();
  }

  async function shareSessionFromLibrary(sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (!isShareableSession(session)) {
      window.alert("Only completed Play sessions can be shared.");
      return;
    }

    try {
      const folderId = await ensureShareFolderId(sessionId);
      if (!folderId) {
        window.alert("Session data is not ready for sharing yet. Open the session once, then try again.");
        return;
      }

      const result = await createShareCode(folderId, sessionId);
      const code = String(result?.code || "");
      if (!code) {
        throw new Error("Share code generation failed.");
      }

      updateSession(sessionId, {
        config: mergeSessionConfig(session.config, {
          shareCode: code,
        }),
      });
      setShareModal({
        open: true,
        code,
        title: session.title || "Play Session",
      });
    } catch (err) {
      console.error("Share session failed:", err);
      window.alert(err?.message || "Unable to create share code.");
    }
  }

  function updateSession(sessionId, patch) {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? {
            ...session,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
          : session
      )
    );
  }

  function updateSessionFiles(sessionId, patch) {
    setSessionFiles((prev) => {
      const nextBundle = {
        ...(prev[sessionId] || {}),
        ...patch,
      };
      queueMicrotask(() => {
        schedulePersistSessionFiles(sessionId, nextBundle);
      });
      return {
        ...prev,
        [sessionId]: nextBundle,
      };
    });
  }

  function deleteSession(sessionId) {
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    setSessionFiles((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setView("main");
    }
  }

  function returnToMain() {
    setView("main");
    setMainTab("library");
  }

  function returnToDashboard() {
    setView("main");
    setMainTab("dashboard");
  }

  if (view === "studio") {
    return (
      <StudioPage
        session={activeSession}
        sessionFiles={activeSessionFileBundle}
        onBack={returnToMain}
        onGoDashboard={returnToDashboard}
        onLogout={onLogout}
        onUpdateSession={updateSession}
        onUpdateSessionFiles={updateSessionFiles}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="topbar topbar-home">
        <div className="topbar-home-inner">
          <div className="brand brand-logo-wrap">
            <div className="brand-logo-slot" aria-hidden="true">Logo</div>
            <div className="brand-logo-text">
              <p className="eyebrow">Just Dance</p>
              <h1>Creator Console</h1>
            </div>
          </div>
          <div className="topbar-home-actions">
            <nav className="tabs" aria-label="Main tabs">
              <a
                href="#dashboard"
                className={mainTab === "dashboard" ? "tab-link active" : "tab-link"}
                onClick={(event) => {
                  event.preventDefault();
                  setMainTab("dashboard");
                }}
              >
                Dashboard
              </a>
              <a
                href="#library"
                className={mainTab === "library" ? "tab-link active" : "tab-link"}
                onClick={(event) => {
                  event.preventDefault();
                  setMainTab("library");
                }}
              >
                My Library
              </a>
            </nav>
            {typeof onLogout === "function" && (
              <button className="btn" onClick={onLogout}>Log Out</button>
            )}
          </div>
        </div>
      </header>

      <main className="content">
        {mainTab === "dashboard" && (
          <Dashboard
            onRecord={startRecordSession}
            onBrowse={() => setMainTab("library")}
            onFriendCode={() => openImportModal("friend-code")}
          />
        )}

        {mainTab === "library" && (
          <Library
            sessions={sessions}
            onOpenSession={openSessionInStudio}
            onDeleteSession={deleteSession}
            onShareSession={shareSessionFromLibrary}
            onRecord={startRecordSession}
            onImport={openImportModal}
          />
        )}
      </main>

      {showImportModal && (
        <ImportSessionModal
          draft={importDraft}
          setDraft={setImportDraft}
          onClose={closeImportModal}
          onSubmit={submitImportSession}
        />
      )}
      {shareModal.open && (
        <ShareCodeModal
          code={shareModal.code}
          title={shareModal.title}
          onClose={closeShareModal}
        />
      )}
    </div>
  );
}

function Dashboard({ onRecord, onBrowse, onFriendCode }) {
  return (
    <section className="dashboard-clean">
      <h2>Quick Start</h2>
      <p className="muted">Choose what you want to do.</p>
      <div className="dash-actions">
        <button className="dash-big-btn" onClick={onRecord}>Record</button>
        <button className="dash-big-btn" onClick={onBrowse}>Browse</button>
        <button className="dash-big-btn" onClick={onFriendCode}>Friend Code</button>
      </div>
    </section>
  );
}

function Library({ sessions, onOpenSession, onDeleteSession, onShareSession, onRecord, onImport }) {
  return (
    <section className="library-wrap">
      <div className="section-head">
        <h2>My Library</h2>
        <div className="top-actions">
          <button className="btn btn-primary" onClick={onRecord}>Record</button>
          <button className="btn" onClick={onImport}>Import</button>
        </div>
      </div>

      {sessions.length === 0 && <p className="muted">No sessions saved yet.</p>}

      <div className="library-list">
        {sessions.map((session) => (
          <article key={session.id} className="session-card">
            <div>
              <h3>{session.title}</h3>
              <p className="muted">{modeLabel(session.mode)}</p>
              <p className="meta-line">{describeSessionConfig(session)}</p>
              <p className="meta-line">Created {formatDateTime(session.createdAt)}</p>
              <p className="meta-line">Last run {session.lastRunSec.toFixed(1)}s | Runs {session.runs}</p>
              {session.status === "missing-data" && (
                <p className="meta-line" style={{ color: "#b91c1c" }}>
                  Session files missing from disk. Re-import required.
                </p>
              )}
            </div>
            <div className="session-actions">
              <button className="btn" onClick={() => onOpenSession(session.id)}>Open Studio</button>
              {isShareableSession(session) && (
                <button className="btn" onClick={() => onShareSession(session.id)}>Share</button>
              )}
              <button className="btn btn-danger" onClick={() => onDeleteSession(session.id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StudioPage({ session, sessionFiles, onBack, onGoDashboard, onLogout, onUpdateSession, onUpdateSessionFiles }) {
  const [phase, setPhase] = useState("idle");
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordingStartMs, setRecordingStartMs] = useState(0);
  const [localCountdown, setLocalCountdown] = useState(3);
  const [cameraState, setCameraState] = useState("requesting");
  const [poseState, setPoseState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("");
  const [compareActive, setCompareActive] = useState(false);
  const [recordedFramesCount, setRecordedFramesCount] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [referenceVideoUrl, setReferenceVideoUrl] = useState("");
  const [showQuickSetup, setShowQuickSetup] = useState(true);
  const [playLayout, setPlayLayout] = useState("overlay");
  const [showPlayWebcam, setShowPlayWebcam] = useState(true);
  const [routineData, setRoutineData] = useState(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [forcePlayUi, setForcePlayUi] = useState(false);
  const [liveScore, setLiveScore] = useState(null);
  const [avgScore, setAvgScore] = useState(null);
  const [bestScore, setBestScore] = useState(null);
  const videoRef = useRef(null);
  const referenceVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const rafRef = useRef(0);
  const lastInferMsRef = useRef(0);
  const lastLandmarksRef = useRef(null);
  const phaseRef = useRef("idle");
  const compareActiveRef = useRef(false);
  const routineRef = useRef(null);
  const sessionModeRef = useRef(session?.mode || "record");
  const playLayoutRef = useRef("overlay");
  const showPlayWebcamRef = useRef(true);
  const recordingFramesRef = useRef([]);
  const recordingStartMsRef = useRef(0);
  const lastSampleMsRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const webcamChunksRef = useRef([]);
  const webcamMimeTypeRef = useRef("");
  const composeCanvasRef = useRef(null);
  const composeRafRef = useRef(0);
  const composeActiveRef = useRef(false);
  const webcamRecordingStopLockRef = useRef(false);
  const scoreStatsRef = useRef({
    total: 0,
    count: 0,
    best: 0,
    lastRenderMs: 0,
  });

  function resetScoring() {
    scoreStatsRef.current = {
      total: 0,
      count: 0,
      best: 0,
      lastRenderMs: 0,
    };
    setLiveScore(null);
    setAvgScore(null);
    setBestScore(null);
  }

  function pushScoreSample(score, nowMs) {
    if (!Number.isFinite(score)) return;
    const clamped = Math.max(0, Math.min(100, score));
    const stats = scoreStatsRef.current;
    stats.total += clamped;
    stats.count += 1;
    stats.best = Math.max(stats.best, clamped);
    if (nowMs - stats.lastRenderMs >= 180 || stats.count <= 1) {
      stats.lastRenderMs = nowMs;
      setLiveScore(roundN(clamped, 1));
      setAvgScore(roundN(stats.total / stats.count, 1));
      setBestScore(roundN(stats.best, 1));
    }
  }

  function stopSideBySideComposer() {
    composeActiveRef.current = false;
    if (composeRafRef.current) {
      cancelAnimationFrame(composeRafRef.current);
      composeRafRef.current = 0;
    }
  }

  function getSupportedWebcamMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4;codecs=h264",
      "video/mp4",
    ];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return "";
  }

  function startSideBySideComposer(width, height) {
    const videoEl = videoRef.current;
    if (!videoEl) return null;

    stopSideBySideComposer();

    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    composeCanvasRef.current = canvas;
    composeActiveRef.current = true;

    const draw = () => {
      if (!composeActiveRef.current) return;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (videoEl.readyState >= 2) {
        ctx.drawImage(videoEl, 0, 0, width, height);
        ctx.drawImage(videoEl, width, 0, width, height);
      }
      if (canvasRef.current) {
        // Overlay pose canvas on the right half to create side-by-side practice footage.
        ctx.drawImage(canvasRef.current, width, 0, width, height);
      }
      composeRafRef.current = requestAnimationFrame(draw);
    };

    composeRafRef.current = requestAnimationFrame(draw);
    if (typeof canvas.captureStream !== "function") {
      stopSideBySideComposer();
      return null;
    }
    return canvas.captureStream(30);
  }

  function startWebcamRecordingCapture() {
    if (!session?.config?.includeWebcamVideo) return true;
    if (typeof MediaRecorder === "undefined") {
      setStatusMessage("Recording started, but browser does not support webcam video export.");
      return false;
    }

    let captureStream = null;
    const width = videoRef.current?.videoWidth || 1280;
    const height = videoRef.current?.videoHeight || 720;
    if (session.config.webcamLayout === "side-by-side") {
      captureStream = startSideBySideComposer(width, height);
    } else {
      captureStream = streamRef.current;
      stopSideBySideComposer();
    }

    if (!captureStream) {
      setStatusMessage("Recording started, but webcam video capture could not start.");
      return false;
    }

    const mimeType = getSupportedWebcamMimeType();
    try {
      const recorder = mimeType ? new MediaRecorder(captureStream, { mimeType }) : new MediaRecorder(captureStream);
      webcamChunksRef.current = [];
      webcamMimeTypeRef.current = mimeType || "video/webm";
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          webcamChunksRef.current.push(event.data);
        }
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      webcamRecordingStopLockRef.current = false;
      return true;
    } catch (err) {
      console.error("Webcam capture start failed:", err);
      setStatusMessage("Recording started, but optional webcam capture failed.");
      stopSideBySideComposer();
      mediaRecorderRef.current = null;
      webcamChunksRef.current = [];
      return false;
    }
  }

  function stopWebcamRecordingCapture({ discard = false } = {}) {
    const recorder = mediaRecorderRef.current;
    stopSideBySideComposer();
    if (!recorder) {
      webcamChunksRef.current = [];
      webcamRecordingStopLockRef.current = false;
      return Promise.resolve(null);
    }
    if (webcamRecordingStopLockRef.current) {
      return Promise.resolve(null);
    }
    webcamRecordingStopLockRef.current = true;

    return new Promise((resolve) => {
      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        const chunks = webcamChunksRef.current;
        webcamChunksRef.current = [];
        mediaRecorderRef.current = null;
        webcamRecordingStopLockRef.current = false;

        if (discard || !chunks.length || !session?.config?.includeWebcamVideo) {
          resolve(null);
          return;
        }

        const blob = new Blob(chunks, { type: webcamMimeTypeRef.current || "video/webm" });
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        const file = new File(
          [blob],
          `${safeRoutineName(session.title)}-webcam.${ext}`,
          { type: blob.type || (ext === "mp4" ? "video/mp4" : "video/webm") }
        );
        resolve(file);
      };

      recorder.onstop = () => setTimeout(finalize, 0);
      recorder.onerror = () => finalize();

      if (recorder.state !== "inactive") {
        try {
          recorder.requestData();
        } catch {
          // Some implementations can throw if requestData isn't supported in state.
        }
        recorder.stop();
      } else {
        setTimeout(finalize, 0);
      }
    });
  }

  useEffect(() => {
    if (!session) return;
    setPhase("idle");
    setElapsedSec(0);
    setCountdownRemaining(0);
    setLocalCountdown(session.countdownSec || 3);
    setStatusMessage("");
    setCompareActive(false);
    setPlayLayout("overlay");
    setShowPlayWebcam(true);
    setForcePlayUi(false);
    resetScoring();
    setRecordedFramesCount(0);
    recordingFramesRef.current = [];
    recordingStartMsRef.current = 0;
    lastSampleMsRef.current = 0;
    webcamChunksRef.current = [];
    webcamMimeTypeRef.current = "";
    webcamRecordingStopLockRef.current = false;
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    setShowQuickSetup(sessionFiles?.hideQuickSetup !== true);
  }, [session?.id, sessionFiles?.hideQuickSetup]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    compareActiveRef.current = compareActive;
  }, [compareActive]);

  useEffect(() => {
    routineRef.current = routineData;
  }, [routineData]);

  useEffect(() => {
    const nextMode =
      session?.mode === "load-routine" ||
        forcePlayUi ||
        (session?.mode === "record" && Boolean(routineData || sessionFiles?.generatedRoutine || sessionFiles?.loadedRoutine))
        ? "load-routine"
        : (session?.mode || "record");
    sessionModeRef.current = nextMode;
  }, [session?.mode, forcePlayUi, routineData, sessionFiles?.generatedRoutine, sessionFiles?.loadedRoutine]);

  useEffect(() => {
    playLayoutRef.current = playLayout;
  }, [playLayout]);

  useEffect(() => {
    showPlayWebcamRef.current = showPlayWebcam;
  }, [showPlayWebcam]);

  useEffect(() => {
    if (playLayout !== "side-by-side") return;
    if (referenceVideoUrl) return;
    setPlayLayout("overlay");
  }, [playLayout, referenceVideoUrl]);

  useEffect(() => {
    const sourceAudio =
      sessionFiles?.playAudioFile ||
      sessionFiles?.loadAudioFile ||
      sessionFiles?.recordAudioFile ||
      null;
    if (!sourceAudio) {
      setAudioUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(sourceAudio);
    setAudioUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [sessionFiles?.playAudioFile, sessionFiles?.loadAudioFile, sessionFiles?.recordAudioFile, session?.id]);

  useEffect(() => {
    const sourceVideo = sessionFiles?.recordedWebcamFile || sessionFiles?.loadWebcamVideoFile || null;
    if (!sourceVideo) {
      setReferenceVideoUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(sourceVideo);
    setReferenceVideoUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [sessionFiles?.recordedWebcamFile, sessionFiles?.loadWebcamVideoFile, session?.id]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function resolveRoutinePackage() {
      if (session.mode !== "load-routine") {
        const fromFiles = sessionFiles?.generatedRoutine || null;
        setRoutineData(fromFiles);
        return;
      }

      const readyRoutine = sessionFiles?.generatedRoutine || sessionFiles?.loadedRoutine || null;
      if (readyRoutine) {
        setRoutineData(readyRoutine);
        return;
      }

      const zipFile = sessionFiles?.loadZipFile;
      if (!zipFile) {
        setRoutineData(null);
        return;
      }

      try {
        setStatusMessage("Loading routine package...");
        const JSZip = (await nativeImport("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
        const zip = await JSZip.loadAsync(zipFile);
        const entries = Object.values(zip.files).filter((entry) => !entry.dir);
        const routineEntry = entries.find((entry) => basename(entry.name).toLowerCase() === "routine.json");
        if (!routineEntry) {
          if (cancelled) return;
          setRoutineData(null);
          setStatusMessage("Package is missing routine.json.");
          return;
        }

        const routineText = await routineEntry.async("string");
        const routine = JSON.parse(routineText);
        const audioEntry = entries.find((entry) => isLikelyAudioFileName(basename(entry.name)));
        const routineWebcamName = basename(routine?.webcam?.fileName || "");
        const webcamEntry = entries.find((entry) => {
          const name = basename(entry.name).toLowerCase();
          if (!isLikelyVideoFileName(name)) return false;
          if (routineWebcamName && basename(entry.name) === routineWebcamName) return true;
          return name.includes("webcam") || name.includes("camera");
        });
        let audioFile = null;
        if (audioEntry) {
          const audioBlob = await audioEntry.async("blob");
          audioFile = new File(
            [audioBlob],
            basename(audioEntry.name),
            { type: audioBlob.type || "audio/mpeg" }
          );
        }
        let webcamFile = null;
        if (webcamEntry) {
          const webcamBlob = await webcamEntry.async("blob");
          webcamFile = new File(
            [webcamBlob],
            basename(webcamEntry.name),
            { type: webcamBlob.type || "video/webm" }
          );
        }

        if (cancelled) return;
        setRoutineData(routine);
        onUpdateSessionFiles(session.id, {
          loadedRoutine: routine,
          loadAudioFile: audioFile,
          loadWebcamVideoFile: webcamFile,
          playAudioFile: audioFile || sessionFiles?.playAudioFile || null,
        });
        setStatusMessage(webcamFile ? "Package loaded with webcam video. Ready to play." : "Package loaded. Ready to play.");
      } catch (err) {
        if (cancelled) return;
        setRoutineData(null);
        setStatusMessage("Failed to read package zip.");
        console.error("Package load failed:", err);
      }
    }

    resolveRoutinePackage();
    return () => {
      cancelled = true;
    };
  }, [
    session?.id,
    session?.mode,
    sessionFiles?.generatedRoutine,
    sessionFiles?.loadedRoutine,
    sessionFiles?.loadZipFile,
  ]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function ensurePoseLandmarker() {
      if (poseLandmarkerRef.current) return;
      setPoseState("loading");

      const { FilesetResolver, PoseLandmarker } = await nativeImport(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
      );

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      setPoseState("ready");
    }

    function resizeCanvasToVideo() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function stopPoseLoop() {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    }

    function runPoseLoop(nowMs) {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      resizeCanvasToVideo();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (
        (sessionModeRef.current === "load-routine" || sessionModeRef.current === "record") &&
        !showPlayWebcamRef.current
      ) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      if (video.readyState >= 2 && poseLandmarkerRef.current) {
        const targetInferInterval = 1000 / 15;
        if (nowMs - lastInferMsRef.current >= targetInferInterval) {
          lastInferMsRef.current = nowMs;
          try {
            const result = poseLandmarkerRef.current.detectForVideo(video, nowMs);
            const landmarks = result?.landmarks?.[0] || null;
            lastLandmarksRef.current = landmarks;

            if (
              phaseRef.current === "recording" &&
              landmarks &&
              recordingStartMsRef.current > 0 &&
              nowMs - lastSampleMsRef.current >= targetInferInterval
            ) {
              const lm2d = landmarks.map((p) => [roundN(p.x, 6), roundN(p.y, 6)]);
              const tSec = Math.max(0, (nowMs - recordingStartMsRef.current) / 1000);
              recordingFramesRef.current.push({
                t: roundN(tSec, 3),
                lm2d,
                angles: extractAnglesFromLm2d(lm2d),
              });
              lastSampleMsRef.current = nowMs;
              setRecordedFramesCount(recordingFramesRef.current.length);
            }
          } catch (err) {
            setPoseState("error");
            console.error("Pose detect error:", err);
          }
        }

        if (compareActiveRef.current && routineRef.current && audioRef.current) {
          const routine = routineRef.current;
          const durationSec = Number(routine.durationSec) || 0;
          let refT = Number(audioRef.current.currentTime) || 0;
          if (durationSec > 0) refT = refT % durationSec;
          const refFrame = nearestFrameAtTime(routine, refT, 0.25);
          if (refFrame?.lm2d) {
            if (playLayoutRef.current !== "side-by-side") {
              drawPoseSkeleton(ctx, lm2dToLandmarks(refFrame.lm2d), canvas.width, canvas.height, "#60a5fa");
            }
            const score = computeFrameScorePercent(refFrame, lastLandmarksRef.current);
            pushScoreSample(score, nowMs);
          }
        }

        drawPoseSkeleton(ctx, lastLandmarksRef.current, canvas.width, canvas.height, "#34d399");
      }

      rafRef.current = requestAnimationFrame(runPoseLoop);
    }

    async function startCamera() {
      const hasMediaApi =
        typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function";

      if (!hasMediaApi) {
        if (cancelled) return;
        setCameraState("denied");
        window.alert("Camera API unavailable. Please enable camera support and permissions. Redirecting to Dashboard.");
        onGoDashboard();
        return;
      }

      setCameraState("requesting");
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setCameraState("denied");
        const reason = err?.name === "NotAllowedError"
          ? "Camera permission denied."
          : `Unable to start camera${err?.message ? `: ${err.message}` : "."}`;
        window.alert(`${reason} Redirecting to Dashboard.`);
        onGoDashboard();
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Browser autoplay policies can block play; stream is still attached.
        }
      }
      setCameraState("live");

      try {
        await ensurePoseLandmarker();
        stopPoseLoop();
        rafRef.current = requestAnimationFrame(runPoseLoop);
      } catch (err) {
        setPoseState("error");
        console.error("Pose model failed to load:", err);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopSideBySideComposer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore cleanup recorder failures.
        }
      }
      mediaRecorderRef.current = null;
      webcamChunksRef.current = [];
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
        poseLandmarkerRef.current = null;
      }
      lastLandmarksRef.current = null;
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session || session.mode !== "record") return;
    const next = Math.max(1, Math.min(30, Number(localCountdown) || 3));
    onUpdateSession(session.id, { countdownSec: next });
  }, [localCountdown, session?.id]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdownRemaining <= 0) {
      const startMs = performance.now();
      recordingStartMsRef.current = startMs;
      lastSampleMsRef.current = startMs - (1000 / 15);
      setPhase("recording");
      setRecordingStartMs(startMs);
      startWebcamRecordingCapture();
      if (audioRef.current && audioUrl) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current
          .play()
          .then(() => setStatusMessage("Recording in progress..."))
          .catch(() => {
            setStatusMessage("Recording started, but browser blocked audio playback.");
          });
      } else {
        setStatusMessage("Recording in progress...");
      }
      return;
    }
    const t = setTimeout(() => setCountdownRemaining((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdownRemaining, audioUrl]);

  useEffect(() => {
    if (phase !== "recording") return;
    const interval = setInterval(() => {
      setElapsedSec((performance.now() - recordingStartMs) / 1000);
    }, 120);
    return () => clearInterval(interval);
  }, [phase, recordingStartMs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (phaseRef.current === "recording") {
        stopRecordingFlow();
        return;
      }
      if (compareActiveRef.current) {
        compareActiveRef.current = false;
        setCompareActive(false);
        if (referenceVideoRef.current) {
          referenceVideoRef.current.pause();
          referenceVideoRef.current.currentTime = 0;
        }
        setStatusMessage("Play session finished.");
      }
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [audioUrl, session?.id]);

  useEffect(() => {
    if (!compareActive || playLayout !== "side-by-side") return;
    const t = setInterval(() => {
      const audio = audioRef.current;
      const refVideo = referenceVideoRef.current;
      if (!audio || !refVideo || audio.paused) return;
      const dt = Math.abs((refVideo.currentTime || 0) - (audio.currentTime || 0));
      if (dt > 0.2) {
        try {
          refVideo.currentTime = audio.currentTime || 0;
        } catch {
          // Ignore sync seek failures while playing.
        }
      }
    }, 220);
    return () => clearInterval(t);
  }, [compareActive, playLayout, referenceVideoUrl, session?.id]);

  if (!session) {
    return (
      <div className="app-root">
        <header className="topbar">
          <div>
            <p className="eyebrow">Studio</p>
            <h1>No Session Selected</h1>
          </div>
          <div className="top-actions">
            <button className="btn" onClick={onBack}>Back To Library</button>
            {typeof onLogout === "function" && (
              <button className="btn" onClick={onLogout}>Log Out</button>
            )}
          </div>
        </header>
        <section className="studio-empty">
          <p className="muted">Open a session from My Library first.</p>
        </section>
      </div>
    );
  }

  function startRecordingFlow() {
    if (cameraState !== "live") {
      setStatusMessage("Camera is not ready yet.");
      return;
    }
    const sourceAudio = sessionFiles?.recordAudioFile || sessionFiles?.playAudioFile || null;
    if (!sourceAudio) {
      setStatusMessage("Recording mode requires an audio file.");
      return;
    }
    const next = Math.max(1, Math.min(30, Number(localCountdown) || 3));
    setLocalCountdown(next);
    setForcePlayUi(false);
    onUpdateSession(session.id, { countdownSec: next, status: "armed" });
    setCompareActive(false);
    compareActiveRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    recordingFramesRef.current = [];
    recordingStartMsRef.current = 0;
    lastSampleMsRef.current = 0;
    webcamChunksRef.current = [];
    setRecordedFramesCount(0);
    onUpdateSessionFiles(session.id, {
      recordedWebcamFile: null,
      recordedWebcamLayout: session.config?.webcamLayout || "raw",
    });
    setElapsedSec(0);
    setCountdownRemaining(next);
    setStatusMessage(`Recording starts in ${next}...`);
    setPhase("countdown");
  }

  async function stopRecordingFlow() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (phaseRef.current === "countdown") {
      await stopWebcamRecordingCapture({ discard: true });
      setPhase("idle");
      setForcePlayUi(false);
      setStatusMessage("Recording cancelled.");
      return;
    }
    const webcamFile = await stopWebcamRecordingCapture({ discard: false });
    setPhase("idle");
    const hasFrames = recordingFramesRef.current.length > 0;
    const duration = hasFrames
      ? Number(recordingFramesRef.current[recordingFramesRef.current.length - 1].t) || 0
      : Math.max(0, elapsedSec);
    setElapsedSec(duration);

    if (!hasFrames) {
      setForcePlayUi(false);
      onUpdateSession(session.id, {
        status: "draft",
        lastRunSec: duration,
      });
      onUpdateSessionFiles(session.id, {
        recordedWebcamFile: null,
        recordedWebcamLayout: session.config?.webcamLayout || "raw",
      });
      setStatusMessage("No pose detected in this run. Try again.");
      return;
    }

    const routine = buildRoutinePayload(session.title, recordingFramesRef.current);
    setRoutineData(routine);
    setPlayLayout("overlay");
    setForcePlayUi(true);
    onUpdateSessionFiles(session.id, {
      generatedRoutine: routine,
      loadedRoutine: routine,
      playAudioFile: sessionFiles?.recordAudioFile || sessionFiles?.playAudioFile || null,
      recordedWebcamFile: webcamFile || null,
      recordedWebcamLayout: session.config?.webcamLayout || "raw",
    });
    onUpdateSession(session.id, {
      mode: "load-routine",
      status: "ready",
      lastRunSec: duration,
      runs: (session.runs || 0) + 1,
      countdownSec: null,
      config: {
        packageZipFileName: `${safeRoutineName(session.title)}-package.zip`,
        requiredContents: ["routine.json", "audio/video source"],
        optionalContents: ["webcam video"],
      },
    });
    setStatusMessage(
      webcamFile
        ? "Recording complete. Webcam video captured and ready in export."
        : (session.config?.includeWebcamVideo
          ? "Recording complete, but webcam capture was not produced by this browser."
          : "Recording complete.")
    );
    phaseRef.current = "idle";
  }

  async function downloadPackage() {
    const existingRoutine = routineData || sessionFiles?.generatedRoutine || null;
    if (!existingRoutine) {
      setStatusMessage("Nothing to export yet. Record first.");
      return;
    }

    const audioFile =
      sessionFiles?.playAudioFile ||
      sessionFiles?.recordAudioFile ||
      sessionFiles?.loadAudioFile ||
      null;
    const webcamFile =
      sessionFiles?.recordedWebcamFile ||
      sessionFiles?.loadWebcamVideoFile ||
      null;
    const packageName = `${safeRoutineName(session.title)}-package.zip`;
    const routineExport = {
      ...existingRoutine,
      song: {
        ...(existingRoutine.song || {}),
        offsetSec: Number(existingRoutine.song?.offsetSec) || 0,
      },
    };
    if (audioFile?.name) {
      routineExport.song.fileName = sanitizeFilename(audioFile.name);
    }
    if (webcamFile?.name) {
      routineExport.webcam = {
        fileName: sanitizeFilename(webcamFile.name),
        layout: sessionFiles?.recordedWebcamLayout || session.config?.webcamLayout || "raw",
      };
    }

    try {
      setDownloadPending(true);
      const JSZip = (await nativeImport("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
      const zip = new JSZip();
      zip.file("routine.json", JSON.stringify(routineExport, null, 2));
      if (audioFile) {
        zip.file(sanitizeFilename(audioFile.name), audioFile);
      }
      if (webcamFile) {
        zip.file(sanitizeFilename(webcamFile.name), webcamFile);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = packageName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);

      const packageFile = new File([blob], packageName, { type: "application/zip" });
      onUpdateSessionFiles(session.id, {
        loadZipFile: packageFile,
        loadZipFileName: packageName,
        generatedRoutine: routineExport,
        loadedRoutine: routineExport,
        playAudioFile: audioFile,
        loadWebcamVideoFile: webcamFile || null,
        recordedWebcamLayout: sessionFiles?.recordedWebcamLayout || "raw",
      });
      onUpdateSession(session.id, {
        config: {
          packageZipFileName: packageName,
          requiredContents: ["routine.json", "audio/video source"],
          optionalContents: ["webcam video"],
        },
      });
      setStatusMessage(webcamFile ? "Package downloaded with webcam video." : "Package downloaded.");
    } catch (err) {
      console.error("Package export failed:", err);
      setStatusMessage("Failed to build package zip.");
    } finally {
      setDownloadPending(false);
    }
  }

  function startCompareFlow() {
    if (!routineData || !Array.isArray(routineData.frames) || routineData.frames.length === 0) {
      setStatusMessage("No routine frames found for compare.");
      return;
    }
    if (!audioRef.current || !audioUrl) {
      setStatusMessage("No audio file found for this play session.");
      return;
    }
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    if (referenceVideoRef.current) {
      referenceVideoRef.current.pause();
      referenceVideoRef.current.currentTime = 0;
    }
    resetScoring();
    audioRef.current
      .play()
      .then(() => {
        if (playLayout === "side-by-side" && referenceVideoRef.current && referenceVideoUrl) {
          referenceVideoRef.current.play().catch(() => {
            // Keep audio as source of truth if video autoplay fails.
          });
        }
        setCompareActive(true);
        compareActiveRef.current = true;
        setStatusMessage("Play session running...");
      })
      .catch(() => {
        setCompareActive(false);
        compareActiveRef.current = false;
        setStatusMessage("Play session could not start audio playback.");
      });
  }

  function stopCompareFlow() {
    compareActiveRef.current = false;
    setCompareActive(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (referenceVideoRef.current) {
      referenceVideoRef.current.pause();
      referenceVideoRef.current.currentTime = 0;
    }
    setStatusMessage("Play session stopped.");
  }

  function togglePlayLayout() {
    if (playLayout === "side-by-side") {
      setPlayLayout("overlay");
      return;
    }
    if (!referenceVideoUrl || !hasReferenceWebcamVideo) {
      setStatusMessage("Side By Side needs a recorded webcam reference video.");
      return;
    }
    setPlayLayout("side-by-side");
  }

  const isPlayUiMode =
    session.mode === "load-routine" ||
    forcePlayUi ||
    (session.mode === "record" && Boolean(routineData || sessionFiles?.generatedRoutine || sessionFiles?.loadedRoutine));
  const isRecordUiMode = session.mode === "record" && !isPlayUiMode;
  const hasReferenceWebcamVideo = Boolean(sessionFiles?.recordedWebcamFile || sessionFiles?.loadWebcamVideoFile);
  const canUseSideBySide = hasReferenceWebcamVideo && Boolean(referenceVideoUrl);
  const isSideBySidePlay = isPlayUiMode && playLayout === "side-by-side" && !!referenceVideoUrl;
  const studioGridClass = [
    "studio-grid",
    isPlayUiMode ? "play-mode" : "",
    isRecordUiMode ? "record-mode" : "",
    isSideBySidePlay ? "split-preview-row" : "",
    showQuickSetup ? "" : "no-setup",
  ]
    .filter(Boolean)
    .join(" ");
  const appRootClassName = isPlayUiMode || isRecordUiMode ? "app-root app-root-play" : "app-root";
  const shownModeLabel = isPlayUiMode ? modeLabel("load-routine") : modeLabel(session.mode);

  return (
    <div className={appRootClassName}>
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">Studio</p>
          <h1>{session.title}</h1>
          <p className="muted">{shownModeLabel}</p>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={onBack}>Back To Library</button>
          {typeof onLogout === "function" && (
            <button className="btn" onClick={onLogout}>Log Out</button>
          )}
        </div>
      </header>

      <section className="studio-wrap">
        <div className="studio-steps">
          <div className={isRecordUiMode ? "step-chip active" : "step-chip"}>1. Setup</div>
          <div className={isRecordUiMode && phase !== "idle" ? "step-chip active" : "step-chip"}>
            {isRecordUiMode ? "2. Record" : "2. Load"}
          </div>
          <div className={session.status === "completed" || session.status === "ready" ? "step-chip active" : "step-chip"}>
            3. Share / Play
          </div>
        </div>

        <div className={studioGridClass}>
          {isPlayUiMode ? (
            <article className="studio-card">
              <h3>Play Session</h3>
              <p className="meta-line">
                Routine: {routineData?.name || "N/A"} | Frames: {routineData?.frames?.length || 0} | Duration:{" "}
                {(Number(routineData?.durationSec) || 0).toFixed(2)}s
              </p>
              {hasReferenceWebcamVideo && (
                <>
                  <p className="meta-line">
                    Webcam video: {(sessionFiles?.recordedWebcamFile || sessionFiles?.loadWebcamVideoFile)?.name}
                  </p>
                  <label className="field">
                    Compare View
                    <select value={playLayout} onChange={(e) => setPlayLayout(e.target.value)}>
                      <option value="overlay">Overlay</option>
                      <option value="side-by-side">Side By Side</option>
                    </select>
                  </label>
                </>
              )}
              <div className="field">
                <span>Live Webcam</span>
                <button className="btn" onClick={() => setShowPlayWebcam((v) => !v)}>
                  {showPlayWebcam ? "On (Show Webcam)" : "Off (Skeleton Only)"}
                </button>
              </div>
              <div className="studio-actions">
                {!compareActive && (
                  <button className="btn btn-primary" onClick={startCompareFlow}>
                    Start Play
                  </button>
                )}
                {compareActive && (
                  <button className="btn btn-danger" onClick={stopCompareFlow}>
                    Stop Play
                  </button>
                )}
                <button className="btn" onClick={downloadPackage} disabled={downloadPending}>
                  {downloadPending ? "Preparing..." : "Download Package"}
                </button>
              </div>
              {statusMessage && <p className="meta-line">{statusMessage}</p>}
            </article>
          ) : (
            <article className="studio-card">
              <h3>{session.mode === "record" ? "Record" : "Mode"}</h3>
              {session.mode === "record" ? (
                <>
                  <label className="field">
                    Required Audio Input
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        const selected = e.target.files?.[0] || null;
                        onUpdateSessionFiles(session.id, { recordAudioFile: selected });
                        onUpdateSession(session.id, {
                          config: {
                            audioFileName: selected?.name || "",
                            includeWebcamVideo: Boolean(session.config?.includeWebcamVideo),
                            webcamLayout: session.config?.webcamLayout || "raw",
                          },
                        });
                      }}
                      disabled={phase !== "idle"}
                    />
                    {sessionFiles?.recordAudioFile?.name && (
                      <small className="muted">Selected: {sessionFiles.recordAudioFile.name}</small>
                    )}
                  </label>

                  <label className="field checkbox-row">
                    <input
                      type="checkbox"
                      checked={Boolean(session.config?.includeWebcamVideo)}
                      onChange={(e) =>
                        onUpdateSession(session.id, {
                          config: {
                            audioFileName: session.config?.audioFileName || sessionFiles?.recordAudioFile?.name || "",
                            includeWebcamVideo: e.target.checked,
                            webcamLayout: session.config?.webcamLayout || "raw",
                          },
                        })
                      }
                      disabled={phase !== "idle"}
                    />
                    Include webcam video in exported package (optional)
                  </label>

                  {Boolean(session.config?.includeWebcamVideo) && (
                    <label className="field">
                      Webcam Layout
                      <select
                        value={session.config?.webcamLayout || "raw"}
                        onChange={(e) =>
                          onUpdateSession(session.id, {
                            config: {
                              audioFileName: session.config?.audioFileName || sessionFiles?.recordAudioFile?.name || "",
                              includeWebcamVideo: true,
                              webcamLayout: e.target.value,
                            },
                          })
                        }
                        disabled={phase !== "idle"}
                      >
                        {WEBCAM_LAYOUT_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="field">
                    Countdown (1-30 sec)
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={localCountdown}
                      onChange={(e) => setLocalCountdown(e.target.value)}
                      disabled={phase !== "idle"}
                    />
                  </label>

                  <div className="studio-actions">
                    {phase === "idle" && (
                      <button className="btn btn-primary" onClick={startRecordingFlow}>
                        Start Recording
                      </button>
                    )}
                    {phase === "countdown" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>
                        Cancel
                      </button>
                    )}
                    {phase === "recording" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>
                        Stop Recording
                      </button>
                    )}
                  </div>

                  <div className="studio-state">
                    {phase === "idle" && <p>Ready</p>}
                    {phase === "countdown" && <p>Countdown: {countdownRemaining}</p>}
                    {phase === "recording" && <p>Recording: {elapsedSec.toFixed(1)}s | Frames: {recordedFramesCount}</p>}
                    <p>{statusMessage || "After recording completes, this card becomes Play Session automatically."}</p>
                  </div>
                </>
              ) : (
                <>
                  <p className="meta-line">Create-from-video mode only needs a video input in config.</p>
                  {statusMessage && <p className="meta-line">{statusMessage}</p>}
                </>
              )}
            </article>
          )}

          {showQuickSetup && (
            <article className="studio-card">
              <div className="studio-card-head">
                <h3>Quick Setup</h3>
                <button
                  className="btn btn-small"
                  onClick={() => {
                    setShowQuickSetup(false);
                    onUpdateSessionFiles(session.id, { hideQuickSetup: true });
                  }}
                >
                  Close
                </button>
              </div>
              <p className="meta-line">{describeSessionConfig(session)}</p>
              <p className="meta-line">
                Camera: {cameraState === "live" ? "Live" : cameraState === "requesting" ? "Requesting permission..." : "Unavailable"}
              </p>
              <p className="meta-line">
                Pose: {poseState === "ready" ? "Tracking" : poseState === "loading" ? "Loading model..." : "Unavailable"}
              </p>
              {session.mode === "load-routine" && (
                <p className="meta-line">Package must include: routine.json + audio (or video with audio). Webcam video is optional.</p>
              )}
              {session.mode === "record" && (
                <p className="meta-line">Only 2 steps: set countdown, then tap Start.</p>
              )}
            </article>
          )}

          <article className="studio-canvas">
            <div className={isSideBySidePlay ? "fake-stage split" : "fake-stage"}>
              <div
                className={
                  (isPlayUiMode || isRecordUiMode) && !showPlayWebcam
                    ? "stage-live play-skeleton"
                    : "stage-live"
                }
              >
                <video ref={videoRef} className="stage-video" autoPlay playsInline muted />
                <canvas ref={canvasRef} className="stage-canvas" />
                {isRecordUiMode && phase === "countdown" && <div className="count-badge center">{countdownRemaining}</div>}
                {isRecordUiMode && phase === "recording" && <div className="rec-pill">REC {elapsedSec.toFixed(1)}s</div>}
              </div>
              {isSideBySidePlay && (
                <div className="stage-reference">
                  <video ref={referenceVideoRef} className="stage-video" src={referenceVideoUrl} playsInline muted />
                </div>
              )}
              {isPlayUiMode && (
                <>
                  <div className="play-info-chip">
                    <strong>{routineData?.name || "Play Session"}</strong>
                    <small>
                      {(Number(routineData?.durationSec) || 0).toFixed(2)}s | {routineData?.frames?.length || 0} frames
                    </small>
                    <small className="score-line">
                      Score: {liveScore == null ? "--" : `${liveScore.toFixed(1)}%`} | Avg: {avgScore == null ? "--" : `${avgScore.toFixed(1)}%`} | Best: {bestScore == null ? "--" : `${bestScore.toFixed(1)}%`}
                    </small>
                  </div>
                  <div className="floating-play-dock" role="group" aria-label="Play controls">
                    {!compareActive && (
                      <button className="btn btn-primary" onClick={startCompareFlow}>
                        Start
                      </button>
                    )}
                    {compareActive && (
                      <button className="btn btn-danger" onClick={stopCompareFlow}>
                        Stop
                      </button>
                    )}
                    <button className="btn" onClick={downloadPackage} disabled={downloadPending}>
                      {downloadPending ? "Preparing..." : "Download"}
                    </button>
                    <span className="dock-sep" aria-hidden="true" />
                    {hasReferenceWebcamVideo && (
                      <button className="btn" onClick={togglePlayLayout} disabled={!canUseSideBySide}>
                        {playLayout === "side-by-side" ? "Overlay" : "Side By Side"}
                      </button>
                    )}
                    <button className="btn" onClick={() => setShowPlayWebcam((v) => !v)}>
                      {showPlayWebcam ? "Webcam On" : "Webcam Off"}
                    </button>
                    {statusMessage && <span className="dock-sep" aria-hidden="true" />}
                    {statusMessage && <span className="play-status-inline">{statusMessage}</span>}
                  </div>
                </>
              )}
              {isRecordUiMode && (
                <>
                  <div className="play-info-chip">
                    <strong>Recording Session</strong>
                    <small>
                      Audio: {sessionFiles?.recordAudioFile?.name || "Required"}
                    </small>
                    <small>
                      Countdown: {Math.max(1, Math.min(30, Number(localCountdown) || 3))}s | View: {showPlayWebcam ? "Webcam" : "Skeleton"}
                    </small>
                  </div>
                  <div className="floating-play-dock" role="group" aria-label="Record controls">
                    <label className={phase !== "idle" ? "btn dock-file-btn disabled" : "btn dock-file-btn"}>
                      {sessionFiles?.recordAudioFile ? "Audio" : "Insert Audio"}
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => {
                          const selected = e.target.files?.[0] || null;
                          onUpdateSessionFiles(session.id, { recordAudioFile: selected });
                          onUpdateSession(session.id, {
                            config: {
                              audioFileName: selected?.name || "",
                              includeWebcamVideo: Boolean(session.config?.includeWebcamVideo),
                              webcamLayout: session.config?.webcamLayout || "raw",
                            },
                          });
                        }}
                        disabled={phase !== "idle"}
                      />
                    </label>
                    <button className="btn" onClick={() => setShowPlayWebcam((v) => !v)}>
                      {showPlayWebcam ? "Webcam On" : "Webcam Off"}
                    </button>
                    <label className="dock-countdown">
                      <span>Countdown</span>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={localCountdown}
                        onChange={(e) => setLocalCountdown(e.target.value)}
                        disabled={phase !== "idle"}
                      />
                    </label>
                    <span className="dock-sep" aria-hidden="true" />
                    {phase === "idle" && (
                      <button className="btn btn-primary" onClick={startRecordingFlow}>
                        Start
                      </button>
                    )}
                    {phase === "countdown" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>
                        Cancel
                      </button>
                    )}
                    {phase === "recording" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>
                        Stop
                      </button>
                    )}
                    {statusMessage && <span className="dock-sep" aria-hidden="true" />}
                    {statusMessage && <span className="play-status-inline">{statusMessage}</span>}
                  </div>
                </>
              )}
            </div>
            <audio ref={audioRef} src={audioUrl} preload="auto" />
          </article>
        </div>
      </section >
    </div >
  );
}

function ImportSessionModal({ draft, setDraft, onClose, onSubmit }) {
  const [loadZipCheck, setLoadZipCheck] = useState({ status: "idle", message: "" });
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const validationError = importValidationError(draft);

  useEffect(() => {
    if (draft.importMode !== "load-package") {
      setLoadZipCheck({ status: "idle", message: "" });
    }
  }, [draft.importMode]);

  function onModeChange(nextMode) {
    setDraft((prev) => ({
      ...prev,
      importMode: nextMode,
      loadZipFileName: nextMode === "load-package" ? prev.loadZipFileName : "",
      loadZipFile: nextMode === "load-package" ? prev.loadZipFile : null,
      sourceVideoFileName: nextMode === "load-video" ? prev.sourceVideoFileName : "",
      sourceVideoFile: nextMode === "load-video" ? prev.sourceVideoFile : null,
      friendShareCode: nextMode === "friend-code" ? prev.friendShareCode : "",
    }));
  }

  async function validateLoadZipFile(file) {
    if (!file) {
      setLoadZipCheck({ status: "idle", message: "" });
      return;
    }
    setLoadZipCheck({ status: "checking", message: "Validating zip contents..." });

    try {
      const JSZip = (await nativeImport("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      const hasRoutineJson = entries.some((entry) => basename(entry.name).toLowerCase() === "routine.json");
      const hasAudioFile = entries.some((entry) => isLikelyAudioFileName(basename(entry.name)));

      if (!hasRoutineJson || !hasAudioFile) {
        const parts = [];
        if (!hasRoutineJson) parts.push("routine.json");
        if (!hasAudioFile) parts.push("audio or video file");
        setLoadZipCheck({
          status: "invalid",
          message: `Zip is missing required content: ${parts.join(" + ")}.`,
        });
        return;
      }

      setLoadZipCheck({
        status: "valid",
        message: "Zip is valid (routine.json + playable audio/video source found).",
      });
    } catch {
      setLoadZipCheck({
        status: "invalid",
        message: "Unable to read zip file. Use a valid .zip package.",
      });
    }
  }

  const zipValidationError =
    draft.importMode === "load-package" &&
      draft.loadZipFileName &&
      loadZipCheck.status !== "valid"
      ? loadZipCheck.message || "Zip package validation failed."
      : "";

  const submitError = validationError || zipValidationError;

  async function handleSubmit() {
    if (submitError || busy) return;
    setBusy(true);
    setProgressMessage("");
    try {
      await onSubmit(draft, (msg) => setProgressMessage(msg || ""));
    } catch (err) {
      setProgressMessage(err?.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Import Session</h2>
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
        </div>

        <label className="field">
          Session Title
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Optional override"
            disabled={busy}
          />
        </label>

        <div className="mode-list">
          {[
            { id: "load-package", label: "Load Package", hint: "Load an exported routine zip package." },
            { id: "load-video", label: "Load From Video", hint: "Convert a video into a routine and open Play session." },
            { id: "friend-code", label: "Friend's Video", hint: "Paste a friend's share code to import their session." },
          ].map((mode) => (
            <label key={mode.id} className={draft.importMode === mode.id ? "mode-item active" : "mode-item"}>
              <input
                type="radio"
                name="import-mode"
                checked={draft.importMode === mode.id}
                onChange={() => onModeChange(mode.id)}
                disabled={busy}
              />
              <span>
                <strong>{mode.label}</strong>
                <small>{mode.hint}</small>
              </span>
            </label>
          ))}
        </div>

        {draft.importMode === "load-package" && (
          <>
            <label className="field">
              Required Routine Package (ZIP)
              <input
                type="file"
                accept="application/zip,.zip,application/x-zip-compressed"
                onChange={async (e) => {
                  const selected = e.target.files?.[0] || null;
                  setDraft((prev) => ({
                    ...prev,
                    loadZipFileName: selected?.name || "",
                    loadZipFile: selected,
                  }));
                  await validateLoadZipFile(selected);
                }}
                disabled={busy}
              />
              {draft.loadZipFileName && <small className="muted">Selected: {draft.loadZipFileName}</small>}
            </label>
            <p className="meta-line">ZIP must contain `routine.json` and an audio file (or video with audio). Webcam video is optional.</p>
            {loadZipCheck.message && (
              <p className="meta-line" style={{ color: loadZipCheck.status === "valid" ? "#73e7bf" : "#ff9298" }}>
                {loadZipCheck.message}
              </p>
            )}
          </>
        )}

        {draft.importMode === "load-video" && (
          <label className="field">
            Source Video File
            <input
              type="file"
              accept="video/*"
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  sourceVideoFileName: e.target.files?.[0]?.name || "",
                  sourceVideoFile: e.target.files?.[0] || null,
                }))
              }
              disabled={busy}
            />
            {draft.sourceVideoFileName && <small className="muted">Selected: {draft.sourceVideoFileName}</small>}
            <small className="muted">This will extract pose frames, create a routine, include the source video, and open Play session.</small>
          </label>
        )}

        {draft.importMode === "friend-code" && (
          <label className="field">
            Friend Share Code
            <input
              type="text"
              value={draft.friendShareCode}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  friendShareCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                }))
              }
              placeholder="Enter code from your friend"
              disabled={busy}
            />
            <small className="muted">This imports your friend's routine/audio package into your library.</small>
          </label>
        )}

        {submitError && <p className="meta-line" style={{ color: "#ff9298" }}>{submitError}</p>}
        {progressMessage && <p className="meta-line">{progressMessage}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={Boolean(submitError) || busy}>
            {busy ? "Processing..." : "Import And Open Studio"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareCodeModal({ code, title, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const node = document.createElement("textarea");
        node.value = code;
        document.body.appendChild(node);
        node.select();
        document.execCommand("copy");
        node.remove();
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Share this code with your friend</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="meta-line">{title}</p>
        <div className="share-code-box">{code}</div>
        {copied && <p className="meta-line">Copied to clipboard.</p>}
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={copyCode}>Copy Code</button>
        </div>
      </div>
    </div>
  );
}

export default StudioWorkspace;
