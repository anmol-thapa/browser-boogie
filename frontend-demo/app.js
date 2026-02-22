import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

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

const ANGLE_WEIGHTS = {
  lElbow: 1.2,
  rElbow: 1.2,
  lShoulder: 1.0,
  rShoulder: 1.0,
  lKnee: 0.7,
  rKnee: 0.7,
};

const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19], [12, 14],
  [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [11, 23], [12, 24], [23, 24],
  [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32],
  [27, 31], [28, 32],
];

const els = {
  modelPath: document.getElementById("modelPath"),
  startCameraBtn: document.getElementById("startCameraBtn"),
  routineName: document.getElementById("routineName"),
  recordFps: document.getElementById("recordFps"),
  recordBtn: document.getElementById("recordBtn"),
  exportBtn: document.getElementById("exportBtn"),
  loadRoutineInput: document.getElementById("loadRoutineInput"),
  useRecordedBtn: document.getElementById("useRecordedBtn"),
  routineVideoInput: document.getElementById("routineVideoInput"),
  videoAnalyzeFps: document.getElementById("videoAnalyzeFps"),
  routineVideoPreview: document.getElementById("routineVideoPreview"),
  videoRoutineCompareView: document.getElementById("videoRoutineCompareView"),
  analyzeVideoBtn: document.getElementById("analyzeVideoBtn"),
  useVideoRoutineBtn: document.getElementById("useVideoRoutineBtn"),
  videoAnalyzeText: document.getElementById("videoAnalyzeText"),
  audioInput: document.getElementById("audioInput"),
  audioPlayer: document.getElementById("audioPlayer"),
  countdownSec: document.getElementById("countdownSec"),
  windowSec: document.getElementById("windowSec"),
  compareBtn: document.getElementById("compareBtn"),
  stopCompareBtn: document.getElementById("stopCompareBtn"),
  blackBackground: document.getElementById("blackBackground"),
  includeWebcamVideo: document.getElementById("includeWebcamVideo"),
  webcamVideoLayout: document.getElementById("webcamVideoLayout"),
  statusText: document.getElementById("statusText"),
  loadedRoutineText: document.getElementById("loadedRoutineText"),
  audioText: document.getElementById("audioText"),
  recordedText: document.getElementById("recordedText"),
  scoreValue: document.getElementById("scoreValue"),
  labelValue: document.getElementById("labelValue"),
  comboValue: document.getElementById("comboValue"),
  timeValue: document.getElementById("timeValue"),
  countdownValue: document.getElementById("countdownValue"),
  stage: document.getElementById("stage"),
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
};

const overlayCtx = els.overlay.getContext("2d");

const state = {
  poseLandmarker: null,
  stream: null,
  loopRunning: false,
  cameraReady: false,
  tracking: {
    targetFps: 15,
    lastInferMs: 0,
    lastLandmarks: null,
    lastAngles: null,
  },
  recording: {
    active: false,
    pending: false,
    pendingUntilMs: 0,
    startMs: 0,
    lastSampleMs: 0,
    fps: 30,
    frames: [],
    webcamChunks: [],
    webcamBlob: null,
    mediaRecorder: null,
    webcamMode: "raw",
    compositeCanvas: null,
    compositeCtx: null,
    compositeStream: null,
  },
  audio: {
    file: null,
    objectUrl: null,
  },
  loadedRoutine: null,
  lastRecordedRoutine: null,
  videoRoutine: {
    file: null,
    objectUrl: null,
    candidateRoutine: null,
    analyzing: false,
  },
  compare: {
    pending: false,
    active: false,
    pendingUntilMs: 0,
    startMs: 0,
    mediaSource: "none",
    score: 0,
    label: "Miss",
    combo: 0,
    meanError: null,
  },
};

function setStatus(text) {
  els.statusText.textContent = `Status: ${text}`;
}

function setLoadedRoutineText(routine) {
  if (!routine) {
    els.loadedRoutineText.textContent = "Loaded routine: none";
    return;
  }
  const framesCount = Array.isArray(routine.frames) ? routine.frames.length : 0;
  const duration = Number(routine.durationSec ?? 0).toFixed(2);
  els.loadedRoutineText.textContent = `Loaded routine: ${routine.name || "Unnamed"} (${framesCount} frames, ${duration}s)`;
}

function setAudioText() {
  if (!state.audio.file) {
    els.audioText.textContent = "Audio: none";
    return;
  }
  const sizeMb = (state.audio.file.size / (1024 * 1024)).toFixed(2);
  els.audioText.textContent = `Audio: ${state.audio.file.name} (${sizeMb} MB)`;
}

function setVideoAnalyzeText(text) {
  if (els.videoAnalyzeText) {
    els.videoAnalyzeText.textContent = text;
  }
}

function updateRecordedText() {
  els.recordedText.textContent = `Recorded frames: ${state.recording.frames.length}`;
}

function updateScoreHud() {
  els.scoreValue.textContent = state.compare.score.toFixed(1);
  els.labelValue.textContent = state.compare.label;
  els.comboValue.textContent = String(state.compare.combo);

  if (state.compare.active) {
    const tSec = getCompareTimelineSec(performance.now(), state.compare.startMs);
    els.timeValue.textContent = `${tSec.toFixed(2)}s`;
  } else {
    els.timeValue.textContent = "0.00s";
  }

  if (state.compare.pending) {
    const remainingSec = Math.max(0, (state.compare.pendingUntilMs - performance.now()) / 1000);
    els.countdownValue.textContent = `${remainingSec.toFixed(1)}s`;
  } else if (state.recording.pending) {
    const remainingSec = Math.max(0, (state.recording.pendingUntilMs - performance.now()) / 1000);
    els.countdownValue.textContent = `${remainingSec.toFixed(1)}s`;
  } else {
    els.countdownValue.textContent = "-";
  }
}

function updateControlState() {
  const hasPose = Boolean(state.poseLandmarker && state.cameraReady);
  const hasRecordedFrames = state.recording.frames.length > 0;
  const hasRoutine = Boolean(state.loadedRoutine);
  const recordingBusy = state.recording.active || state.recording.pending;
  const compareBusy = state.compare.active || state.compare.pending;
  const hasVideoFile = Boolean(state.videoRoutine.file);
  const hasVideoCandidate = Boolean(state.videoRoutine.candidateRoutine);

  els.recordBtn.disabled = !hasPose || compareBusy;
  els.exportBtn.disabled = !hasRecordedFrames || recordingBusy;
  els.useRecordedBtn.disabled = !Boolean(state.lastRecordedRoutine);
  els.compareBtn.disabled = !(hasPose && hasRoutine) || compareBusy || recordingBusy;
  els.stopCompareBtn.disabled = !compareBusy;
  if (els.analyzeVideoBtn) {
    els.analyzeVideoBtn.disabled = !hasVideoFile || recordingBusy || compareBusy || state.videoRoutine.analyzing;
  }
  if (els.useVideoRoutineBtn) {
    els.useVideoRoutineBtn.disabled = !hasVideoCandidate || state.videoRoutine.analyzing;
  }
  if (els.webcamVideoLayout) {
    els.webcamVideoLayout.disabled = !els.includeWebcamVideo.checked;
  }
}

function resizeCanvasToVideo() {
  const width = els.video.videoWidth || 1280;
  const height = els.video.videoHeight || 720;
  els.overlay.width = width;
  els.overlay.height = height;
}

function pointXY(landmarks, index) {
  const p = landmarks[index];
  return [p.x, p.y];
}

function angleDegrees(a, b, c) {
  const baX = a[0] - b[0];
  const baY = a[1] - b[1];
  const bcX = c[0] - b[0];
  const bcY = c[1] - b[1];
  const normBA = Math.hypot(baX, baY);
  const normBC = Math.hypot(bcX, bcY);
  const denom = normBA * normBC;
  if (denom < 1e-8) {
    return null;
  }
  const cosTheta = Math.max(-1, Math.min(1, (baX * bcX + baY * bcY) / denom));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

function extractAngles(landmarks) {
  const angles = {
    lElbow: angleDegrees(pointXY(landmarks, LEFT_SHOULDER), pointXY(landmarks, LEFT_ELBOW), pointXY(landmarks, LEFT_WRIST)),
    rElbow: angleDegrees(pointXY(landmarks, RIGHT_SHOULDER), pointXY(landmarks, RIGHT_ELBOW), pointXY(landmarks, RIGHT_WRIST)),
    lShoulder: angleDegrees(pointXY(landmarks, LEFT_ELBOW), pointXY(landmarks, LEFT_SHOULDER), pointXY(landmarks, LEFT_HIP)),
    rShoulder: angleDegrees(pointXY(landmarks, RIGHT_ELBOW), pointXY(landmarks, RIGHT_SHOULDER), pointXY(landmarks, RIGHT_HIP)),
    lKnee: angleDegrees(pointXY(landmarks, LEFT_HIP), pointXY(landmarks, LEFT_KNEE), pointXY(landmarks, LEFT_ANKLE)),
    rKnee: angleDegrees(pointXY(landmarks, RIGHT_HIP), pointXY(landmarks, RIGHT_KNEE), pointXY(landmarks, RIGHT_ANKLE)),
  };

  const cleaned = {};
  Object.entries(angles).forEach(([k, v]) => {
    if (v !== null && Number.isFinite(v)) {
      cleaned[k] = Number(v.toFixed(2));
    }
  });
  return cleaned;
}

function landmarksToLm2d(landmarks) {
  return landmarks.map((lm) => [Number(lm.x.toFixed(4)), Number(lm.y.toFixed(4))]);
}

function buildPoseFrame(landmarks, tSec) {
  return {
    t: Number(tSec.toFixed(3)),
    lm2d: landmarksToLm2d(landmarks),
    angles: extractAngles(landmarks),
  };
}

function scoreAngles(userAngles, referenceAngles) {
  let weightedError = 0;
  let totalWeight = 0;

  Object.entries(ANGLE_WEIGHTS).forEach(([joint, weight]) => {
    if (joint in userAngles && joint in referenceAngles) {
      weightedError += Math.abs(userAngles[joint] - referenceAngles[joint]) * weight;
      totalWeight += weight;
    }
  });

  if (totalWeight === 0) {
    return { score: 0, label: "Miss", meanError: null };
  }

  const meanError = weightedError / totalWeight;
  const score = Math.max(0, Math.min(100, 100 - meanError * 1.25));
  let label = "Miss";
  if (score >= 85) {
    label = "Perfect";
  } else if (score >= 70) {
    label = "Good";
  } else if (score >= 50) {
    label = "Ok";
  }

  return {
    score,
    label,
    meanError,
  };
}

function mirroredAngles(angles) {
  return {
    lElbow: angles.rElbow,
    rElbow: angles.lElbow,
    lShoulder: angles.rShoulder,
    rShoulder: angles.lShoulder,
    lKnee: angles.rKnee,
    rKnee: angles.lKnee,
  };
}

function getRoutineDurationSec(routine) {
  if (Number(routine.durationSec) > 0) {
    return Number(routine.durationSec);
  }
  if (!Array.isArray(routine.frames) || routine.frames.length === 0) {
    return 1;
  }
  return Math.max(1e-6, Number(routine.frames[routine.frames.length - 1].t ?? 0));
}

function findReferenceFrame(routine, tSec, windowSec) {
  const duration = getRoutineDurationSec(routine);
  const tLoop = ((tSec % duration) + duration) % duration;
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const frame of routine.frames) {
    const frameT = Number(frame.t ?? 0);
    const delta = Math.abs(frameT - tLoop);
    if (delta <= windowSec && delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }

  return best;
}

function findNearestFrame(routine, tSec) {
  const duration = getRoutineDurationSec(routine);
  const tLoop = ((tSec % duration) + duration) % duration;
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const frame of routine.frames) {
    const frameT = Number(frame.t ?? 0);
    const delta = Math.abs(frameT - tLoop);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }

  return best;
}

function drawSkeleton(lm2d, color, lineWidth, pointRadius, region = null) {
  const width = region?.width ?? els.overlay.width;
  const height = region?.height ?? els.overlay.height;
  const originX = region?.x ?? 0;
  const originY = region?.y ?? 0;

  overlayCtx.strokeStyle = color;
  overlayCtx.fillStyle = color;
  overlayCtx.lineWidth = lineWidth;

  for (const [s, e] of POSE_CONNECTIONS) {
    const p1 = lm2d[s];
    const p2 = lm2d[e];
    if (!p1 || !p2) continue;
    overlayCtx.beginPath();
    overlayCtx.moveTo(originX + p1[0] * width, originY + p1[1] * height);
    overlayCtx.lineTo(originX + p2[0] * width, originY + p2[1] * height);
    overlayCtx.stroke();
  }

  for (const [x, y] of lm2d) {
    overlayCtx.beginPath();
    overlayCtx.arc(originX + x * width, originY + y * height, pointRadius, 0, Math.PI * 2);
    overlayCtx.fill();
  }
}

function drawText(text, x, y, color = "#ffffff", sizePx = 24) {
  overlayCtx.fillStyle = color;
  overlayCtx.font = `${sizePx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
  overlayCtx.fillText(text, x, y);
}

function safeRoutineName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "routine";
}

function validateRoutineJson(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Routine JSON must be an object.");
  }
  if (!Array.isArray(data.frames) || data.frames.length === 0) {
    throw new Error("Routine JSON must contain a non-empty frames array.");
  }
  return {
    version: Number(data.version ?? 1),
    name: String(data.name ?? "Loaded Routine"),
    fps: Number(data.fps ?? 30),
    durationSec: Number(data.durationSec ?? getRoutineDurationSec(data)),
    song: data.song ?? { title: "Unknown", offsetSec: 0 },
    frames: data.frames,
  };
}

function buildRoutineFromRecording() {
  const frames = state.recording.frames;
  if (!frames.length) {
    return null;
  }

  const durationSec = Number(frames[frames.length - 1].t ?? 0);
  const fps = durationSec > 0 ? (frames.length - 1) / durationSec : state.recording.fps;
  const songTitle = state.audio.file?.name ?? "Unknown Track";

  return {
    version: 1,
    name: els.routineName.value.trim() || "User Routine",
    fps: Number(fps.toFixed(2)),
    durationSec: Number(durationSec.toFixed(3)),
    song: {
      title: songTitle,
      fileName: state.audio.file?.name ?? null,
      offsetSec: 0,
    },
    frames,
  };
}

function sanitizeFilename(name) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned || "file";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isZipFile(file) {
  if (!file) {
    return false;
  }
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return (
    name.endsWith(".zip") ||
    type === "application/zip" ||
    type === "application/x-zip-compressed"
  );
}

function basename(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || "";
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function guessMimeTypeFromName(name) {
  const lower = normalizeName(name);
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "application/octet-stream";
}

function makeFileFromBlob(blob, name) {
  return new File([blob], name, { type: blob.type || guessMimeTypeFromName(name) });
}

function collectZipFiles(zip) {
  return Object.values(zip.files).filter((entry) => !entry.dir);
}

function findRoutineJsonEntry(entries) {
  return (
    entries.find((entry) => normalizeName(entry.name) === "routine.json") ||
    entries.find((entry) => normalizeName(basename(entry.name)) === "routine.json") ||
    null
  );
}

function buildMediaCandidateNames(fileName) {
  const original = normalizeName(fileName);
  const sanitized = normalizeName(sanitizeFilename(fileName));
  const candidates = new Set();
  if (original) candidates.add(original);
  if (sanitized) candidates.add(sanitized);
  if (original) {
    candidates.add(`source-${original}`);
    candidates.add(`audio-${original}`);
  }
  if (sanitized) {
    candidates.add(`source-${sanitized}`);
    candidates.add(`audio-${sanitized}`);
  }
  return candidates;
}

function findMediaEntryByRoutineFileName(entries, fileName) {
  const candidates = buildMediaCandidateNames(fileName);
  return (
    entries.find((entry) => candidates.has(normalizeName(basename(entry.name)))) ||
    null
  );
}

async function exportPackage() {
  const routine = buildRoutineFromRecording();
  if (!routine) {
    setStatus("no recording to export");
    return;
  }

  state.lastRecordedRoutine = routine;
  const routineBlob = new Blob([JSON.stringify(routine)], { type: "application/json" });
  const exportName = safeRoutineName(routine.name);

  const files = [
    {
      path: "routine.json",
      name: `${exportName}.json`,
      blob: routineBlob,
    },
  ];

  if (state.audio.file) {
    files.push({
      path: `audio/${sanitizeFilename(state.audio.file.name)}`,
      name: `audio-${sanitizeFilename(state.audio.file.name)}`,
      blob: state.audio.file,
    });
  }

  if (state.loadedRoutine?.song?.source === "video" && state.videoRoutine.file) {
    files.push({
      path: `video/source-${sanitizeFilename(state.videoRoutine.file.name)}`,
      name: `${exportName}-source-${sanitizeFilename(state.videoRoutine.file.name)}`,
      blob: state.videoRoutine.file,
    });
  }

  if (els.includeWebcamVideo.checked && state.recording.webcamBlob) {
    const webcamFileName =
      state.recording.webcamMode === "side-by-side"
        ? "webcam-side-by-side.webm"
        : "webcam.webm";
    files.push({
      path: `video/${webcamFileName}`,
      name: `${exportName}-${webcamFileName}`,
      blob: state.recording.webcamBlob,
    });
  }

  try {
    const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.path, file.blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${exportName}-package.zip`);
    setStatus(`package exported (${files.length} files)`);
  } catch {
    for (const file of files) {
      downloadBlob(file.blob, file.name);
    }
    setStatus("zip unavailable, exported files separately");
  }

  updateControlState();
}

async function handleLoadRoutineFile(file) {
  if (!file) {
    return;
  }
  try {
    if (isZipFile(file)) {
      await handleLoadRoutinePackage(file);
      return;
    }

    const text = await file.text();
    const parsed = JSON.parse(text);
    state.loadedRoutine = validateRoutineJson(parsed);
    setLoadedRoutineText(state.loadedRoutine);
    setStatus("routine loaded from file");
    updateControlState();
  } catch (err) {
    setStatus(`failed to load routine: ${err.message}`);
  }
}

async function handleLoadRoutinePackage(file) {
  const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
  const zip = await JSZip.loadAsync(file);
  const entries = collectZipFiles(zip);
  if (!entries.length) {
    throw new Error("Package zip is empty.");
  }

  const routineEntry = findRoutineJsonEntry(entries);
  if (!routineEntry) {
    throw new Error("Invalid package: missing routine.json.");
  }

  let routineParsed;
  try {
    const routineText = await routineEntry.async("string");
    routineParsed = JSON.parse(routineText);
  } catch {
    throw new Error("Invalid package: routine.json is not valid JSON.");
  }

  const routine = validateRoutineJson(routineParsed);
  const songFileName = routine.song?.fileName ? String(routine.song.fileName) : "";
  const isVideoSource = routine.song?.source === "video";

  let audioFile = null;
  let videoFile = null;

  if (isVideoSource) {
    if (!songFileName) {
      throw new Error("Invalid package: routine expects source='video' but song.fileName is missing.");
    }
    const sourceVideoEntry = findMediaEntryByRoutineFileName(entries, songFileName);
    if (!sourceVideoEntry) {
      throw new Error(`Invalid package: missing source video file for '${songFileName}'.`);
    }
    const videoBlob = await sourceVideoEntry.async("blob");
    videoFile = makeFileFromBlob(videoBlob, basename(sourceVideoEntry.name));
  } else if (songFileName) {
    const audioEntry = findMediaEntryByRoutineFileName(entries, songFileName);
    if (!audioEntry) {
      throw new Error(`Invalid package: missing audio file for '${songFileName}'.`);
    }
    const audioBlob = await audioEntry.async("blob");
    audioFile = makeFileFromBlob(audioBlob, basename(audioEntry.name));
  }

  if (videoFile) {
    setRoutineVideoFile(videoFile);
    setVideoAnalyzeText("Video source loaded from package.");
  } else {
    setRoutineVideoFile(null);
  }

  if (audioFile) {
    setAudioFile(audioFile);
  } else if (!isVideoSource) {
    setAudioFile(null);
  }

  state.loadedRoutine = routine;
  setLoadedRoutineText(state.loadedRoutine);
  setStatus("routine package loaded");
  updateControlState();
}

function clearVideoRoutineCandidate(message = "Video routine: none") {
  state.videoRoutine.candidateRoutine = null;
  setVideoAnalyzeText(message);
  updateControlState();
}

function setRoutineVideoFile(file) {
  if (state.videoRoutine.objectUrl) {
    URL.revokeObjectURL(state.videoRoutine.objectUrl);
    state.videoRoutine.objectUrl = null;
  }

  state.videoRoutine.file = file ?? null;
  state.videoRoutine.candidateRoutine = null;
  if (!state.videoRoutine.file) {
    els.routineVideoPreview.removeAttribute("src");
    els.routineVideoPreview.load();
    clearVideoRoutineCandidate("Video routine: none");
    return;
  }

  const videoUrl = URL.createObjectURL(state.videoRoutine.file);
  state.videoRoutine.objectUrl = videoUrl;
  els.routineVideoPreview.src = videoUrl;
  els.routineVideoPreview.load();
  clearVideoRoutineCandidate(`Video selected: ${state.videoRoutine.file.name}. Preview it, then analyze.`);
}

function ensureVideoMetadata(videoEl) {
  if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to read video metadata."));
    };
    const cleanup = () => {
      videoEl.removeEventListener("loadedmetadata", onLoaded);
      videoEl.removeEventListener("error", onError);
    };
    videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
    videoEl.addEventListener("error", onError, { once: true });
  });
}

function seekVideo(videoEl, timeSec) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to seek within the uploaded video."));
    };
    const cleanup = () => {
      videoEl.removeEventListener("seeked", onSeeked);
      videoEl.removeEventListener("error", onError);
    };
    videoEl.addEventListener("seeked", onSeeked, { once: true });
    videoEl.addEventListener("error", onError, { once: true });
    videoEl.currentTime = Math.max(0, timeSec);
  });
}

async function analyzeVideoToRoutine() {
  if (!state.videoRoutine.file) {
    setStatus("select a video first");
    return;
  }

  let analysisLandmarker = null;
  try {
    state.videoRoutine.analyzing = true;
    updateControlState();
    setStatus("loading pose model for video analysis");
    setVideoAnalyzeText("Analyzing video...");
    analysisLandmarker = await createAnalysisPoseLandmarker();

    const preview = els.routineVideoPreview;
    preview.pause();
    await ensureVideoMetadata(preview);
    const durationSec = Number(preview.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error("Video duration is invalid.");
    }

    const requestedFps = Number(els.videoAnalyzeFps.value) || 15;
    const analyzeFps = Math.max(5, Math.min(30, Math.round(requestedFps)));
    els.videoAnalyzeFps.value = String(analyzeFps);
    const stepSec = 1 / analyzeFps;

    const frames = [];
    let sampleCount = 0;
    let foundCount = 0;
    let timestampMs = 0;

    setStatus(`analyzing video at ${analyzeFps} fps`);
    for (let t = 0; t <= durationSec; t += stepSec) {
      const clampedT = Math.min(durationSec, t);
      await seekVideo(preview, clampedT);
      sampleCount += 1;
      timestampMs += 1;
      const result = analysisLandmarker.detectForVideo(preview, timestampMs);
      const landmarks = result.landmarks?.[0] ?? null;
      if (!landmarks) {
        continue;
      }
      foundCount += 1;
      frames.push(buildPoseFrame(landmarks, clampedT));
    }

    const detectionRatio = sampleCount > 0 ? foundCount / sampleCount : 0;
    if (frames.length < 8 || detectionRatio < 0.15) {
      state.videoRoutine.candidateRoutine = null;
      setVideoAnalyzeText("No person found in the uploaded video. Try a clearer full-body dance clip.");
      setStatus("video analysis failed: no person found");
      return;
    }

    state.videoRoutine.candidateRoutine = {
      version: 1,
      name: `${state.videoRoutine.file.name.replace(/\.[^.]+$/, "")} Routine`,
      fps: analyzeFps,
      durationSec: Number(durationSec.toFixed(3)),
      song: {
        title: state.videoRoutine.file.name,
        fileName: state.videoRoutine.file.name,
        offsetSec: 0,
        source: "video",
      },
      frames,
    };

    setVideoAnalyzeText(
      `Video analysis ready: ${frames.length} matched frames (${Math.round(
        detectionRatio * 100
      )}% pose detection). Click "Use Video Routine".`
    );
    setStatus("video routine analyzed successfully");
  } catch (err) {
    state.videoRoutine.candidateRoutine = null;
    setVideoAnalyzeText(`Video analysis failed: ${err.message}`);
    setStatus(`video analysis failed: ${err.message}`);
  } finally {
    if (analysisLandmarker) {
      analysisLandmarker.close();
    }
    state.videoRoutine.analyzing = false;
    updateControlState();
  }
}

function useVideoRoutineCandidate() {
  if (!state.videoRoutine.candidateRoutine) {
    setStatus("analyze a video first");
    return;
  }
  state.loadedRoutine = state.videoRoutine.candidateRoutine;
  setLoadedRoutineText(state.loadedRoutine);
  setStatus("video routine loaded for compare");
  updateControlState();
}

function setAudioFile(file) {
  if (state.audio.objectUrl) {
    URL.revokeObjectURL(state.audio.objectUrl);
    state.audio.objectUrl = null;
  }

  state.audio.file = file ?? null;
  if (!state.audio.file) {
    els.audioPlayer.removeAttribute("src");
    els.audioPlayer.load();
    setAudioText();
    return;
  }

  const url = URL.createObjectURL(state.audio.file);
  state.audio.objectUrl = url;
  els.audioPlayer.src = url;
  els.audioPlayer.load();
  setAudioText();
}

function playMediaFromStart(mediaEl, sessionLabel) {
  if (!mediaEl) {
    return;
  }
  try {
    mediaEl.pause();
    mediaEl.currentTime = 0;
    const maybePromise = mediaEl.play();
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {
        setStatus(`${sessionLabel} started (audio blocked: press play on Song Preview)`);
      });
    }
  } catch {
    setStatus(`${sessionLabel} started (audio unavailable)`);
  }
}

function stopMediaPlayback(mediaEl) {
  if (!mediaEl) {
    return;
  }
  mediaEl.pause();
  try {
    mediaEl.currentTime = 0;
  } catch {
    // Ignore browsers that restrict manual currentTime writes while metadata is loading.
  }
}

function isMediaClockReady(mediaEl) {
  return (
    mediaEl &&
    !mediaEl.paused &&
    Number.isFinite(mediaEl.currentTime) &&
    mediaEl.currentTime > 0
  );
}

function getRecordingTimelineSec(nowMs, startMs) {
  if (state.audio.file && isMediaClockReady(els.audioPlayer)) {
    return els.audioPlayer.currentTime;
  }
  return Math.max(0, (nowMs - startMs) / 1000);
}

function getCompareTimelineSec(nowMs, startMs) {
  if (state.compare.mediaSource === "video" && isMediaClockReady(els.routineVideoPreview)) {
    return els.routineVideoPreview.currentTime;
  }
  if (state.compare.mediaSource === "audio" && state.audio.file && isMediaClockReady(els.audioPlayer)) {
    return els.audioPlayer.currentTime;
  }
  return Math.max(0, (nowMs - startMs) / 1000);
}

function getWebcamVideoMode() {
  if (!els.webcamVideoLayout) {
    return "raw";
  }
  return els.webcamVideoLayout.value === "side-by-side" ? "side-by-side" : "raw";
}

function getPreferredMediaRecorderOptions() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return { mimeType: "video/webm;codecs=vp9" };
  }
  if (MediaRecorder.isTypeSupported("video/webm")) {
    return { mimeType: "video/webm" };
  }
  return null;
}

function resetWebcamCaptureState() {
  state.recording.webcamChunks = [];
  state.recording.webcamBlob = null;
  state.recording.mediaRecorder = null;
  state.recording.webcamMode = "raw";
  state.recording.compositeCanvas = null;
  state.recording.compositeCtx = null;
  state.recording.compositeStream = null;
}

function startWebcamVideoCapture() {
  resetWebcamCaptureState();

  if (!els.includeWebcamVideo.checked) {
    return;
  }
  if (!state.stream || typeof MediaRecorder === "undefined") {
    setStatus("recording started (webcam video export not supported in this browser)");
    return;
  }

  const selectedMode = getWebcamVideoMode();
  state.recording.webcamMode = selectedMode;
  let captureStream = state.stream;

  if (selectedMode === "side-by-side") {
    const sourceWidth = els.overlay.width || els.video.videoWidth || 1280;
    const sourceHeight = els.overlay.height || els.video.videoHeight || 720;
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = sourceWidth * 2;
    compositeCanvas.height = sourceHeight;
    const compositeCtx = compositeCanvas.getContext("2d");

    if (!compositeCtx || typeof compositeCanvas.captureStream !== "function") {
      state.recording.webcamMode = "raw";
      setStatus("recording started (side-by-side capture unsupported, falling back to raw webcam)");
    } else {
      state.recording.compositeCanvas = compositeCanvas;
      state.recording.compositeCtx = compositeCtx;
      captureStream = compositeCanvas.captureStream(Math.max(10, state.recording.fps || 30));
      state.recording.compositeStream = captureStream;
    }
  }

  const options = getPreferredMediaRecorderOptions();
  const recorder = options ? new MediaRecorder(captureStream, options) : new MediaRecorder(captureStream);
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.recording.webcamChunks.push(event.data);
    }
  };

  recorder.start(250);
  state.recording.mediaRecorder = recorder;
}

async function stopWebcamVideoCapture() {
  const recorder = state.recording.mediaRecorder;
  if (!recorder) {
    return;
  }

  await new Promise((resolve) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.stop();
  });

  const mimeType = recorder.mimeType || "video/webm";
  state.recording.webcamBlob = new Blob(state.recording.webcamChunks, { type: mimeType });
  state.recording.mediaRecorder = null;
  if (state.recording.compositeStream) {
    state.recording.compositeStream.getTracks().forEach((track) => track.stop());
  }
  state.recording.compositeStream = null;
  state.recording.compositeCanvas = null;
  state.recording.compositeCtx = null;
}

function startRecordingNow(startMs = performance.now()) {
  state.recording.active = true;
  state.recording.pending = false;
  state.recording.pendingUntilMs = 0;
  state.recording.startMs = startMs;
  state.recording.lastSampleMs = 0;
  state.recording.fps = Number(els.recordFps.value) || 30;
  if (!Array.isArray(state.recording.frames) || state.recording.frames.length === 0) {
    state.recording.frames = [];
  }
  startWebcamVideoCapture();
  playMediaFromStart(state.audio.file ? els.audioPlayer : null, "recording");
  updateRecordedText();
  els.recordBtn.textContent = "Stop Recording";
  setStatus("recording started");
}

async function stopRecording() {
  state.recording.active = false;
  state.recording.pending = false;
  state.recording.pendingUntilMs = 0;
  await stopWebcamVideoCapture();
  stopMediaPlayback(state.audio.file ? els.audioPlayer : null);
  els.recordBtn.textContent = "Start Recording";
  state.lastRecordedRoutine = buildRoutineFromRecording();
  updateControlState();
  setStatus(`recording stopped (${state.recording.frames.length} frames)`);
}

function startRecordingCountdown() {
  const countdownSec = getCountdownSeconds();
  const now = performance.now();
  state.recording.active = false;
  state.recording.pending = true;
  state.recording.pendingUntilMs = now + countdownSec * 1000;
  state.recording.startMs = 0;
  state.recording.lastSampleMs = 0;
  state.recording.fps = Number(els.recordFps.value) || 30;
  state.recording.frames = [];
  resetWebcamCaptureState();
  updateRecordedText();
  els.recordBtn.textContent = "Cancel Recording";
  setStatus(`recording countdown started (${countdownSec}s)`);
  updateControlState();
}

function cancelRecordingCountdown() {
  state.recording.pending = false;
  state.recording.pendingUntilMs = 0;
  state.recording.frames = [];
  resetWebcamCaptureState();
  stopMediaPlayback(state.audio.file ? els.audioPlayer : null);
  els.recordBtn.textContent = "Start Recording";
  setStatus("recording countdown cancelled");
  updateControlState();
}

function resetCompareState() {
  state.compare.pending = false;
  state.compare.active = false;
  state.compare.pendingUntilMs = 0;
  state.compare.startMs = 0;
  state.compare.mediaSource = "none";
  state.compare.score = 0;
  state.compare.label = "Miss";
  state.compare.combo = 0;
  state.compare.meanError = null;
  updateScoreHud();
  updateControlState();
}

function getCountdownSeconds() {
  const raw = Number(els.countdownSec.value);
  const normalized = Number.isFinite(raw) ? Math.round(raw) : 3;
  const clamped = Math.max(1, Math.min(30, normalized));
  els.countdownSec.value = String(clamped);
  return clamped;
}

function startCompare() {
  if (!state.loadedRoutine) {
    setStatus("load a routine first");
    return;
  }
  const countdownSec = getCountdownSeconds();
  const now = performance.now();

  resetCompareState();
  stopMediaPlayback(els.audioPlayer);
  stopMediaPlayback(els.routineVideoPreview);
  els.audioPlayer.loop = false;
  els.routineVideoPreview.loop = false;
  const hasVideoRoutineSource =
    state.loadedRoutine?.song?.source === "video" &&
    Boolean(state.videoRoutine.file) &&
    Boolean(els.routineVideoPreview?.src);
  if (hasVideoRoutineSource) {
    state.compare.mediaSource = "video";
  } else if (state.audio.file) {
    state.compare.mediaSource = "audio";
  } else {
    state.compare.mediaSource = "none";
  }

  state.compare.pending = true;
  state.compare.pendingUntilMs = now + countdownSec * 1000;
  setStatus(`countdown started (${countdownSec}s)`);

  updateControlState();
}

function stopCompare(reason = "compare stopped") {
  resetCompareState();
  stopMediaPlayback(els.audioPlayer);
  stopMediaPlayback(els.routineVideoPreview);
  setStatus(reason);
}

function shouldAutoStopCompare(nowMs) {
  if (!state.compare.active || !state.loadedRoutine) {
    return false;
  }

  const compareT = getCompareTimelineSec(nowMs, state.compare.startMs);
  const durationSec = getRoutineDurationSec(state.loadedRoutine);
  const reachedDuration = compareT >= durationSec;
  const mediaEnded =
    (state.compare.mediaSource === "video" && els.routineVideoPreview.ended) ||
    (state.compare.mediaSource === "audio" && els.audioPlayer.ended);

  if (reachedDuration || mediaEnded) {
    stopCompare("compare completed");
    updateControlState();
    return true;
  }

  return false;
}

async function ensurePoseLandmarker() {
  if (state.poseLandmarker) {
    return;
  }

  const modelPath = els.modelPath.value.trim();
  if (!modelPath) {
    throw new Error("Model path is required.");
  }

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  state.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

async function createAnalysisPoseLandmarker() {
  const modelPath = els.modelPath.value.trim();
  if (!modelPath) {
    throw new Error("Model path is required.");
  }

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

async function startCamera() {
  try {
    const hasModernGetUserMedia =
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";
    if (!hasModernGetUserMedia) {
      const protocol = window.location.protocol;
      const host = window.location.hostname;
      const secureHint = protocol === "https:" || host === "localhost" || host === "127.0.0.1";
      if (!secureHint) {
        throw new Error("Camera API unavailable on this origin. Use HTTPS or http://localhost.");
      }
      throw new Error("Camera API not available in this browser. Use latest Chrome/Edge/Safari.");
    }

    setStatus("initializing pose model");
    await ensurePoseLandmarker();

    setStatus("requesting webcam");
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: false,
    });

    els.video.srcObject = state.stream;
    await els.video.play();
    state.tracking.lastInferMs = 0;
    state.tracking.lastLandmarks = null;
    state.tracking.lastAngles = null;
    resizeCanvasToVideo();
    state.cameraReady = true;

    setStatus("camera started");
    updateControlState();

    if (!state.loopRunning) {
      state.loopRunning = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    setStatus(`failed to start camera: ${err.message}`);
  }
}

function maybeRecordFrame(landmarks, nowMs) {
  if (!state.recording.active) {
    return;
  }
  const minDeltaMs = 1000 / Math.max(1, state.recording.fps);
  if (nowMs - state.recording.lastSampleMs < minDeltaMs) {
    return;
  }

  state.recording.lastSampleMs = nowMs;
  const tSec = getRecordingTimelineSec(nowMs, state.recording.startMs);
  state.recording.frames.push(buildPoseFrame(landmarks, tSec));
  updateRecordedText();
}

function isVideoRoutineSideBySideView() {
  return (
    state.compare.active &&
    state.compare.mediaSource === "video" &&
    els.videoRoutineCompareView &&
    els.videoRoutineCompareView.value === "side-by-side"
  );
}

function getSideBySideRegions() {
  const fullWidth = els.overlay.width;
  const fullHeight = els.overlay.height;
  const halfWidth = Math.floor(fullWidth / 2);
  return {
    left: { x: 0, y: 0, width: halfWidth, height: fullHeight },
    right: { x: halfWidth, y: 0, width: fullWidth - halfWidth, height: fullHeight },
  };
}

function renderBaseLayer() {
  const width = els.overlay.width;
  const height = els.overlay.height;

  if (isVideoRoutineSideBySideView()) {
    const { left, right } = getSideBySideRegions();
    overlayCtx.fillStyle = "#000";
    overlayCtx.fillRect(0, 0, width, height);

    if (els.routineVideoPreview.readyState >= 2) {
      overlayCtx.drawImage(
        els.routineVideoPreview,
        left.x,
        left.y,
        left.width,
        left.height
      );
    }

    if (state.cameraReady) {
      overlayCtx.drawImage(els.video, right.x, right.y, right.width, right.height);
    }

    overlayCtx.strokeStyle = "rgba(255,255,255,0.35)";
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(left.width, 0);
    overlayCtx.lineTo(left.width, height);
    overlayCtx.stroke();

    overlayCtx.fillStyle = "#ffffff";
    overlayCtx.font = "bold 20px 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif";
    overlayCtx.fillText("VIDEO", 14, 28);
    overlayCtx.fillText("WEBCAM", right.x + 14, 28);
    return;
  }

  if (els.blackBackground.checked) {
    overlayCtx.fillStyle = "#000";
    overlayCtx.fillRect(0, 0, width, height);
    return;
  }

  if (state.cameraReady) {
    overlayCtx.drawImage(els.video, 0, 0, width, height);
  } else {
    overlayCtx.fillStyle = "#000";
    overlayCtx.fillRect(0, 0, width, height);
  }
}

function renderCompareCountdown(nowMs) {
  if (!state.compare.pending) {
    return;
  }
  const remainingMs = state.compare.pendingUntilMs - nowMs;
  if (remainingMs <= 0) {
    state.compare.pending = false;
    state.compare.active = true;
    state.compare.startMs = nowMs;
    if (state.compare.mediaSource === "video") {
      playMediaFromStart(els.routineVideoPreview, "compare");
    } else if (state.compare.mediaSource === "audio") {
      playMediaFromStart(els.audioPlayer, "compare");
    }
    setStatus("compare started");
    updateControlState();
    return;
  }

  const width = els.overlay.width;
  const height = els.overlay.height;
  const remainingWholeSec = Math.max(1, Math.ceil(remainingMs / 1000));

  drawCenteredCountdown(remainingWholeSec, "GET READY", width, height);
}

function drawCenteredCountdown(secondsValue, subtitle, width, height) {
  overlayCtx.textAlign = "center";
  overlayCtx.textBaseline = "middle";
  overlayCtx.fillStyle = "#ffffff";
  overlayCtx.font = "bold 150px 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif";
  overlayCtx.fillText(String(secondsValue), width / 2, height / 2);
  overlayCtx.font = "bold 36px 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif";
  overlayCtx.fillText(subtitle, width / 2, height / 2 - 110);
  overlayCtx.textAlign = "start";
  overlayCtx.textBaseline = "alphabetic";
}

function renderRecordingCountdown(nowMs) {
  if (!state.recording.pending) {
    return;
  }
  const remainingMs = state.recording.pendingUntilMs - nowMs;
  if (remainingMs <= 0) {
    startRecordingNow(nowMs);
    updateControlState();
    return;
  }

  const width = els.overlay.width;
  const height = els.overlay.height;
  const remainingWholeSec = Math.max(1, Math.ceil(remainingMs / 1000));
  drawCenteredCountdown(remainingWholeSec, "RECORDING STARTS", width, height);
}

function labelColor(label) {
  if (label === "Perfect") return "#62ff74";
  if (label === "Good") return "#61d9ff";
  if (label === "Ok") return "#ffd24a";
  return "#ff6b6b";
}

function renderSideBySideCaptureFrame() {
  if (!state.recording.active || state.recording.webcamMode !== "side-by-side") {
    return;
  }
  const compositeCanvas = state.recording.compositeCanvas;
  const compositeCtx = state.recording.compositeCtx;
  if (!compositeCanvas || !compositeCtx) {
    return;
  }

  const halfWidth = Math.floor(compositeCanvas.width / 2);
  const height = compositeCanvas.height;

  compositeCtx.fillStyle = "#000";
  compositeCtx.fillRect(0, 0, compositeCanvas.width, height);

  if (state.cameraReady && els.video.readyState >= 2) {
    compositeCtx.drawImage(els.video, 0, 0, halfWidth, height);
  }
  compositeCtx.drawImage(els.overlay, halfWidth, 0, halfWidth, height);

  compositeCtx.strokeStyle = "rgba(255,255,255,0.35)";
  compositeCtx.lineWidth = 2;
  compositeCtx.beginPath();
  compositeCtx.moveTo(halfWidth, 0);
  compositeCtx.lineTo(halfWidth, height);
  compositeCtx.stroke();

  compositeCtx.fillStyle = "#ffffff";
  compositeCtx.font = "bold 28px 'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif";
  compositeCtx.fillText("WEBCAM", 18, 36);
  compositeCtx.fillText("STAGE", halfWidth + 18, 36);
}

function loop(nowMs) {
  if (!state.loopRunning) {
    return;
  }

  renderBaseLayer();
  if (shouldAutoStopCompare(nowMs)) {
    renderRecordingCountdown(nowMs);
    renderCompareCountdown(nowMs);
    updateScoreHud();
    requestAnimationFrame(loop);
    return;
  }

  if (state.poseLandmarker && state.cameraReady && els.video.readyState >= 2) {
    const result = state.poseLandmarker.detectForVideo(els.video, nowMs);
    const landmarks = result.landmarks?.[0] ?? null;
    const sideBySide = isVideoRoutineSideBySideView();
    const regions = sideBySide ? getSideBySideRegions() : null;

    let liveAngles = null;

    if (landmarks) {
      const liveLm2d = landmarksToLm2d(landmarks);
      drawSkeleton(liveLm2d, "#33ff90", 2, 2, regions ? regions.right : null);
      liveAngles = extractAngles(landmarks);
      maybeRecordFrame(landmarks, nowMs);
    }

    if (state.compare.active && state.loadedRoutine) {
      const compareT = getCompareTimelineSec(nowMs, state.compare.startMs);
      const windowSec = Math.max(0.01, Number(els.windowSec.value) || 0.2);

      const refFrame = findReferenceFrame(state.loadedRoutine, compareT, windowSec) || findNearestFrame(state.loadedRoutine, compareT);
      if (!sideBySide && refFrame?.lm2d) {
        drawSkeleton(refFrame.lm2d, "#4db0ff", 2, 2, regions ? regions.left : null);
      }

      if (liveAngles && refFrame?.angles) {
        const normalScore = scoreAngles(liveAngles, refFrame.angles);
        const mirroredScore = scoreAngles(mirroredAngles(liveAngles), refFrame.angles);
        const bestScore = mirroredScore.score > normalScore.score ? mirroredScore : normalScore;
        state.compare.score = bestScore.score;
        state.compare.label = bestScore.label;
        state.compare.meanError = bestScore.meanError;

        if (bestScore.label === "Perfect" || bestScore.label === "Good") {
          state.compare.combo += 1;
        } else {
          state.compare.combo = 0;
        }
      }

      const scoreX = regions ? regions.right.x + 24 : 24;
      drawText(`${state.compare.label} ${state.compare.score.toFixed(1)}`, scoreX, 84, labelColor(state.compare.label), 30);
    }
  }

  renderRecordingCountdown(nowMs);
  renderCompareCountdown(nowMs);
  renderSideBySideCaptureFrame();
  updateScoreHud();
  requestAnimationFrame(loop);
}

els.startCameraBtn.addEventListener("click", () => {
  startCamera();
});

els.recordBtn.addEventListener("click", async () => {
  if (state.recording.active) {
    await stopRecording();
  } else if (state.recording.pending) {
    cancelRecordingCountdown();
  } else {
    startRecordingCountdown();
  }
  updateControlState();
});

els.exportBtn.addEventListener("click", async () => {
  await exportPackage();
  updateControlState();
});

els.loadRoutineInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  handleLoadRoutineFile(file);
});

els.routineVideoInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0] ?? null;
  setRoutineVideoFile(file);
});

els.analyzeVideoBtn.addEventListener("click", async () => {
  await analyzeVideoToRoutine();
});

els.useVideoRoutineBtn.addEventListener("click", () => {
  useVideoRoutineCandidate();
});

els.useRecordedBtn.addEventListener("click", () => {
  if (!state.lastRecordedRoutine) {
    setStatus("no previous recording available");
    return;
  }
  state.loadedRoutine = state.lastRecordedRoutine;
  setLoadedRoutineText(state.loadedRoutine);
  setStatus("loaded last recording as reference");
  updateControlState();
});

els.audioInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0] ?? null;
  setAudioFile(file);
});

els.includeWebcamVideo.addEventListener("change", () => {
  updateControlState();
});

if (els.webcamVideoLayout) {
  els.webcamVideoLayout.addEventListener("change", () => {
    updateControlState();
  });
}

els.compareBtn.addEventListener("click", () => {
  startCompare();
});

els.stopCompareBtn.addEventListener("click", () => {
  stopCompare();
});

els.routineVideoPreview.addEventListener("ended", () => {
  if (state.compare.active && state.compare.mediaSource === "video") {
    stopCompare("compare completed (video ended)");
  }
});

els.audioPlayer.addEventListener("ended", () => {
  if (state.compare.active && state.compare.mediaSource === "audio") {
    stopCompare("compare completed (audio ended)");
  }
});

window.addEventListener("resize", () => {
  resizeCanvasToVideo();
});

window.addEventListener("beforeunload", () => {
  if (state.audio.objectUrl) {
    URL.revokeObjectURL(state.audio.objectUrl);
  }
  if (state.videoRoutine.objectUrl) {
    URL.revokeObjectURL(state.videoRoutine.objectUrl);
  }
});

updateRecordedText();
updateScoreHud();
updateControlState();
setLoadedRoutineText(null);
setAudioText();
setStatus("idle");
