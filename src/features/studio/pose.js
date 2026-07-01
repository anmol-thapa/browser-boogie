import {
  MODEL_PATH,
  POSE_CONNECTIONS,
  LEFT_SHOULDER, RIGHT_SHOULDER,
  LEFT_ELBOW, RIGHT_ELBOW,
  LEFT_WRIST, RIGHT_WRIST,
  LEFT_HIP, RIGHT_HIP,
  LEFT_KNEE, RIGHT_KNEE,
  LEFT_ANKLE, RIGHT_ANKLE,
  SCORE_POINT_IDS,
} from "./constants";
import { nativeImport, roundN, normalizeDifficulty, difficultyParams } from "./utils";

export function drawPoseSkeleton(ctx, landmarks, width, height, color = "#34d399") {
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

export function extractAnglesFromLm2d(lm2d) {
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

export function lm2dToLandmarks(lm2d) {
  if (!Array.isArray(lm2d)) return null;
  return lm2d.map((p) => ({ x: Number(p?.[0]) || 0, y: Number(p?.[1]) || 0 }));
}

export function buildRoutinePayload(name, frames, options = {}) {
  const safeFrames = Array.isArray(frames) ? frames : [];
  const durationSec = safeFrames.length > 0 ? Number(safeFrames[safeFrames.length - 1].t) || 0 : 0;
  const fps =
    safeFrames.length >= 2 && durationSec > 0
      ? roundN((safeFrames.length - 1) / durationSec, 2)
      : 30;
  const difficulty = normalizeDifficulty(options?.difficulty);

  return {
    version: 1,
    name: name || "User Routine",
    difficulty,
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

export function nearestFrameAtTime(routine, tSec, windowSec = 0.25) {
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

function poseSimilarityPercent(refLm2d, liveLm2d, difficulty) {
  const refNorm = normalizeLm2dForScore(refLm2d);
  const liveNorm = normalizeLm2dForScore(liveLm2d);
  if (!refNorm || !liveNorm) return null;
  const params = difficultyParams(difficulty);
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
  const similarity = Math.exp(-params.poseDecay * avgDist);
  return Math.max(0, Math.min(100, similarity * 100));
}

function angleSimilarityPercent(refAngles, liveAngles, difficulty) {
  if (!refAngles || !liveAngles) return null;
  const keys = ["lElbow", "rElbow", "lShoulder", "rShoulder", "lKnee", "rKnee"];
  const params = difficultyParams(difficulty);
  let total = 0;
  let count = 0;
  for (const key of keys) {
    const ref = Number(refAngles[key]);
    const live = Number(liveAngles[key]);
    if (!Number.isFinite(ref) || !Number.isFinite(live)) continue;
    const diff = Math.abs(ref - live);
    const similarity = Math.max(0, 1 - diff / params.angleToleranceDeg);
    total += similarity;
    count += 1;
  }
  if (count < 3) return null;
  return (total / count) * 100;
}

export function computeFrameScorePercent(referenceFrame, liveLandmarks, difficulty) {
  if (!referenceFrame?.lm2d || !Array.isArray(liveLandmarks) || liveLandmarks.length < 29) return null;
  const liveLm2d = liveLandmarks.map((p) => [Number(p?.x) || 0, Number(p?.y) || 0]);
  const refAngles = referenceFrame.angles && typeof referenceFrame.angles === "object"
    ? referenceFrame.angles
    : extractAnglesFromLm2d(referenceFrame.lm2d);
  const liveAngles = extractAnglesFromLm2d(liveLm2d);

  const poseScore = poseSimilarityPercent(referenceFrame.lm2d, liveLm2d, difficulty);
  const angleScore = angleSimilarityPercent(refAngles, liveAngles, difficulty);

  if (poseScore == null && angleScore == null) return null;
  if (poseScore == null) return angleScore;
  if (angleScore == null) return poseScore;
  return 0.55 * angleScore + 0.45 * poseScore;
}

// Shared promise so parallel calls reuse the same vision runtime load.
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
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error(`Media event failed: ${eventName}`)); };
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

export async function getVideoDurationSec(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number(video.duration) || 0); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read video metadata.")); };
    video.src = url;
  });
}

export async function trimVideoWithFFmpeg(file, maxSec, onProgress, ffmpegRef) {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const ffmpeg = new FFmpeg();
  if (ffmpegRef) ffmpegRef.current = ffmpeg;
  ffmpeg.on("progress", ({ progress }) => onProgress && onProgress(Math.round(progress * 100)));
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  const ext = file.name.split(".").pop() || "mp4";
  const inName = `input.${ext}`;
  const outName = `output.mp4`;
  await ffmpeg.writeFile(inName, await fetchFile(file));
  await ffmpeg.exec(["-i", inName, "-t", String(maxSec), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outName]);
  const data = await ffmpeg.readFile(outName);
  await ffmpeg.deleteFile(inName);
  await ffmpeg.deleteFile(outName);
  ffmpeg.terminate();
  if (ffmpegRef) ffmpegRef.current = null;
  return new File([data.buffer], `${file.name.replace(/\.[^.]+$/, "")}-trimmed.mp4`, { type: "video/mp4" });
}

export async function buildRoutineFromVideoFile(videoFile, routineName, onProgress, options = {}) {
  const landmarker = await createImportPoseLandmarker();
  const difficulty = normalizeDifficulty(options?.difficulty);
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

    const MAX_ROUTINE_SEC = 120;
    const effectiveDuration = Math.min(duration, MAX_ROUTINE_SEC);
    const sampleFps = 15;
    const stepSec = 1 / sampleFps;
    const totalSamples = Math.max(1, Math.ceil(effectiveDuration * sampleFps));
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

    const routine = buildRoutinePayload(routineName, frames, { difficulty });
    routine.durationSec = roundN(effectiveDuration, 3);
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
