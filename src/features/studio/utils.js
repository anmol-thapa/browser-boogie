import { getSavedSession } from "../../lib/supabaseClient";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_OPTIONS,
  DIFFICULTY_XP_MULT,
  LEVELS,
  MODE_OPTIONS,
  PERSIST_FILE_KEYS,
  PERSIST_JSON_KEYS,
  PERSIST_VALUE_KEYS,
  STORAGE_KEY_PREFIX,
  XP_PER_PLAY,
} from "./constants";

export function nativeImport(moduleUrl) {
  return Function("u", "return import(u)")(moduleUrl);
}

export function roundN(v, digits) {
  const scale = Math.pow(10, digits);
  return Math.round(Number(v) * scale) / scale;
}

export function normalizeDifficulty(value, fallback = DEFAULT_DIFFICULTY) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }
  // legacy data stored "high", treat as "hard"
  if (normalized === "high") return "hard";
  return fallback;
}

export function difficultyLabel(value) {
  return DIFFICULTY_OPTIONS.find((opt) => opt.id === normalizeDifficulty(value))?.label || "Hard";
}

export function difficultyParams(value) {
  const level = normalizeDifficulty(value);
  if (level === "easy") {
    return { windowSec: 0.8, poseDecay: 0.7, angleToleranceDeg: 140 };
  }
  if (level === "medium") {
    return { windowSec: 0.5, poseDecay: 1, angleToleranceDeg: 120 };
  }
  return { windowSec: 0.3, poseDecay: 1.5, angleToleranceDeg: 90 };
}

export function scoreToLetterGrade(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s >= 95) return "A+";
  if (s >= 90) return "A";
  if (s >= 85) return "B+";
  if (s >= 80) return "B";
  if (s >= 75) return "C+";
  if (s >= 70) return "C";
  if (s >= 65) return "D";
  return "F";
}

export function modeLabel(mode) {
  return MODE_OPTIONS.find((item) => item.id === mode)?.label || mode;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function basename(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || "";
}

export function sanitizeFilename(name) {
  const cleaned = String(name || "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "file";
}

export function safeRoutineName(name) {
  return String(name || "routine")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "routine";
}

export function isLikelyAudioFileName(name) {
  return /\.(mp3|wav|m4a|ogg|aac|flac|mp4|mov|webm|m4v)$/i.test(String(name || ""));
}

export function isLikelyVideoFileName(name) {
  return /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(String(name || ""));
}

export function storageKeyForUser(userId) {
  return `${STORAGE_KEY_PREFIX}::${userId || "guest_local"}`;
}

export function loadStoredSessions(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function sessionTitleFromMode(mode) {
  if (mode === "record") return "New Recording";
  if (mode === "load-routine") return "Play Session";
  if (mode === "create-video") return "Video Conversion";
  return "Studio Session";
}

export function importValidationError(draft) {
  if (draft.importMode === "load-video") {
    if (!draft.sourceVideoFile) return "Load from video requires a video file.";
  }
  if (draft.importMode === "friend-code") {
    if (!String(draft.friendShareCode || "").trim()) return "Friend's video requires a share code.";
  }
  return "";
}

export function defaultImportDraft() {
  return {
    title: "",
    importMode: "load-video",
    sourceVideoFileName: "",
    sourceVideoFile: null,
    sourceVideoDifficulty: DEFAULT_DIFFICULTY,
    friendShareCode: "",
  };
}

export function makeFolderId() {
  return Math.random().toString(16).slice(2, 18).padEnd(16, "0");
}

export function randomShareCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function buildCurrentUserProfile() {
  const session = getSavedSession();
  const rawId = String(session?.user?.id || session?.user?.email || "guest_local");
  const userId = rawId.replace(/[^a-zA-Z0-9._:@-]+/g, "_").slice(0, 120) || "guest_local";
  const username = session?.user?.user_metadata?.username;
  const rawDisplay = typeof username === "string" && username.trim()
    ? username.trim()
    : (session?.user?.email?.split("@")[0] || "Guest Dancer");
  const displayName = String(rawDisplay).slice(0, 48) || "Guest Dancer";
  return { userId, displayName };
}

export function computeXpFromRuns(runs) {
  if (!Array.isArray(runs)) return 0;
  const seen = new Set();
  let xp = 0;
  for (const run of runs) {
    const sid = run?.sessionId;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const mult = DIFFICULTY_XP_MULT[normalizeDifficulty(run?.difficulty)] ?? 1;
    xp += XP_PER_PLAY * mult;
  }
  return Math.round(xp);
}

export function computeLevel(xp) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.xpRequired) current = lvl;
    else break;
  }
  const idx = LEVELS.indexOf(current);
  const next = LEVELS[idx + 1] || null;
  return { current, next, xp };
}

export function computeAchievements(runs) {
  if (!Array.isArray(runs)) return {};
  const uniqueSessions = new Set(runs.map((r) => r?.sessionId).filter(Boolean));
  const uniqueCount = uniqueSessions.size;
  const hasShared = runs.some((r) => r?.sessionSource === "friend-share");
  return {
    first_move: { earned: uniqueCount >= 1, progress: Math.min(uniqueCount, 1), total: 1 },
    getting_used_to_it: { earned: uniqueCount >= 10, progress: Math.min(uniqueCount, 10), total: 10 },
    duet: { earned: hasShared, progress: hasShared ? 1 : 0, total: 1 },
  };
}

export function emptyUserStats(profile) {
  return {
    userId: profile?.userId || "guest_local",
    displayName: profile?.displayName || "Dancer",
    runs: 0,
    averageScore: 0,
    bestScore: 0,
    longestDurationSec: 0,
    grade: "N/A",
    lastRunAt: "",
    recentRuns: [],
    xp: 0,
    level: computeLevel(0),
    achievements: computeAchievements([]),
  };
}

export function statsRowToSummary(row, fallbackUserId, fallbackDisplay) {
  if (!row) {
    return {
      userId: fallbackUserId,
      displayName: fallbackDisplay,
      runs: 0,
      averageScore: 0,
      bestScore: 0,
      longestDurationSec: 0,
      grade: "N/A",
      lastRunAt: "",
      recentRuns: [],
    };
  }
  const runs = Array.isArray(row.runs) ? row.runs : [];
  const totalRuns = Number(row.total_runs) || runs.length;
  const averageScore = totalRuns > 0 ? Number(row.sum_average || 0) / totalRuns : 0;
  const longestDurationSec = runs.reduce((max, r) => Math.max(max, Number(r?.durationSec) || 0), 0);
  const recentRuns = runs.slice(-10).reverse();
  const xp = computeXpFromRuns(runs);
  return {
    userId: row.user_id || fallbackUserId,
    displayName: row.display_name || fallbackDisplay,
    runs: totalRuns,
    averageScore: roundN(averageScore, 2),
    bestScore: roundN(Number(row.best_score) || 0, 2),
    longestDurationSec: roundN(longestDurationSec, 2),
    grade: totalRuns > 0 ? scoreToLetterGrade(averageScore) : "N/A",
    lastRunAt: row.last_run_at || "",
    recentRuns,
    xp,
    level: computeLevel(xp),
    achievements: computeAchievements(runs),
  };
}

export function isShareableSession(session) {
  if (!session) return false;
  return session.mode === "load-routine" || session.status === "ready" || session.status === "completed";
}

export function deriveSessionConfigFromBundle(bundle = {}) {
  const routine =
    (bundle.loadedRoutine && typeof bundle.loadedRoutine === "object" ? bundle.loadedRoutine : null) ||
    (bundle.generatedRoutine && typeof bundle.generatedRoutine === "object" ? bundle.generatedRoutine : null);
  const difficulty = normalizeDifficulty(routine?.difficulty, DEFAULT_DIFFICULTY);
  const zipName = bundle.loadZipFile?.name || "";
  const title = routine?.name || basename(zipName).replace(/\.zip$/i, "") || "Friend Session";
  const config = {
    packageZipFileName: zipName || `${safeRoutineName(title)}-package.zip`,
    requiredContents: ["routine.json", "audio/video source"],
    optionalContents: ["webcam video"],
    difficulty,
  };
  return { title, config };
}

export function mergeSessionConfig(currentConfig, patchConfig) {
  return {
    ...(currentConfig && typeof currentConfig === "object" ? currentConfig : {}),
    ...(patchConfig && typeof patchConfig === "object" ? patchConfig : {}),
  };
}

export function buildSessionFromDraft(draft) {
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
    const includeWebcamVideo = draft.recordIncludeWebcamVideo !== false;
    base.config = {
      audioFileName: draft.recordAudioFileName,
      includeWebcamVideo,
      webcamLayout: includeWebcamVideo ? (draft.recordWebcamLayout || "raw") : null,
      difficulty: normalizeDifficulty(draft.recordDifficulty, DEFAULT_DIFFICULTY),
    };
  } else if (draft.mode === "load-routine") {
    base.config = {
      packageZipFileName: draft.loadZipFileName,
      requiredContents: ["routine.json", "audio/video source"],
      optionalContents: ["webcam video"],
      difficulty: normalizeDifficulty(draft.loadDifficulty, DEFAULT_DIFFICULTY),
    };
  } else if (draft.mode === "create-video") {
    base.config = {
      videoFileName: draft.createVideoFileName,
      difficulty: normalizeDifficulty(draft.createVideoDifficulty, DEFAULT_DIFFICULTY),
    };
  }

  return base;
}

export function describeSessionConfig(session) {
  if (session.mode === "record") {
    const webcam = session.config.includeWebcamVideo
      ? `Webcam: ${session.config.webcamLayout === "side-by-side" ? "Side-By-Side" : "Raw"}`
      : "Webcam: none";
    return `Audio: ${session.config.audioFileName || "none"} | Difficulty: ${difficultyLabel(session.config?.difficulty)} | ${webcam}`;
  }
  if (session.mode === "load-routine") {
    const base = `Play Package: ${session.config.packageZipFileName}`;
    const withDifficulty = `${base} | Difficulty: ${difficultyLabel(session.config?.difficulty)}`;
    if (session.config?.shareCode) {
      return `${withDifficulty} | Share: ${session.config.shareCode}`;
    }
    return withDifficulty;
  }
  if (session.mode === "create-video") {
    return `Video: ${session.config.videoFileName} | Difficulty: ${difficultyLabel(session.config?.difficulty)}`;
  }
  return "";
}

export function hasPersistableContent(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  return [...PERSIST_FILE_KEYS, ...PERSIST_JSON_KEYS, ...PERSIST_VALUE_KEYS].some((key) => {
    const value = bundle[key];
    if (value == null) return false;
    if (value instanceof File) return true;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return String(value).length > 0;
  });
}

export function presetMediaInfo(manifestFiles) {
  const mediaFile = manifestFiles?.playAudioFile || manifestFiles?.loadWebcamVideoFile || manifestFiles?.createVideoFile;
  const hasReferenceVideo = Boolean(manifestFiles?.loadWebcamVideoFile);
  return {
    mediaFileName: mediaFile?.name || "",
    hasReferenceVideo,
    referenceVideoFileName: manifestFiles?.loadWebcamVideoFile?.name || "",
  };
}
