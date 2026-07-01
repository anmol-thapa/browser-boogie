import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_DIFFICULTY,
  MODEL_PATH,
  DIFFICULTY_OPTIONS,
  PLAY_VIEW_OPTIONS,
  WEBCAM_LAYOUT_OPTIONS,
  WEBCAM_VIDEO_BITRATE,
  WEBCAM_AUDIO_BITRATE,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_RECORDING_DURATION_SEC,
  LS_HIDE_RECORD_LIMIT_WARN,
} from "../constants";
import {
  nativeImport,
  normalizeDifficulty,
  difficultyLabel,
  difficultyParams,
  scoreToLetterGrade,
  modeLabel,
  describeSessionConfig,
  roundN,
  safeRoutineName,
  sanitizeFilename,
  basename,
  isLikelyAudioFileName,
  isLikelyVideoFileName,
} from "../utils";
import {
  drawPoseSkeleton,
  extractAnglesFromLm2d,
  lm2dToLandmarks,
  buildRoutinePayload,
  nearestFrameAtTime,
  computeFrameScorePercent,
} from "../pose";
import { PracticeRunSummaryModal, RecordingLimitBanner } from "./Modals";

function PlayerSettingsPopup({ playLayout, difficulty, webcamOn, canUseSideBySide, onLayoutChange, onDifficultyChange, onWebcamToggle, onClose }) {
  const selectedView = PLAY_VIEW_OPTIONS.find((o) => o.id === playLayout) || PLAY_VIEW_OPTIONS[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal camera-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Player Settings</h2>
          <button className="btn" onClick={onClose}>Done</button>
        </div>

        <div className="camera-setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>View Mode</span>
          <select
            className="player-settings-select"
            value={playLayout}
            onChange={(e) => onLayoutChange(e.target.value)}
          >
            {PLAY_VIEW_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} disabled={opt.id === "side-by-side" && !canUseSideBySide}>
                {opt.label}{opt.id === "side-by-side" && !canUseSideBySide ? " (no reference video)" : ""}
              </option>
            ))}
          </select>
          <small style={{ color: "#6b7280", fontSize: "0.78rem", lineHeight: 1.4 }}>
            {selectedView.description}
          </small>
        </div>

        <div className="camera-setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Difficulty</span>
          <select
            className="player-settings-select"
            value={difficulty}
            onChange={(e) => onDifficultyChange(e.target.value)}
          >
            {DIFFICULTY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <small style={{ color: "#6b7280", fontSize: "0.78rem", lineHeight: 1.4 }}>
            {difficulty === "easy" && "More tolerance for small differences. Good for warming up or beginners."}
            {difficulty === "medium" && "Balanced scoring. Rewards accurate movement without being too strict."}
            {difficulty === "hard" && "Tight accuracy required. Every angle and position is judged precisely."}
          </small>
        </div>

        <label className="camera-setting-row">
          <div className="camera-setting-text">
            <span>Show live webcam</span>
            <small>Display your webcam feed on the canvas during playback. Uncheck for a clean black background (skeleton only).</small>
          </div>
          <input
            type="checkbox"
            className="camera-toggle"
            checked={webcamOn}
            onChange={(e) => onWebcamToggle(e.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}

function CameraSettingsPopup({ webcamOn, stripFromUpload, onWebcamToggle, onStripToggle, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal camera-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Camera Settings</h2>
          <button className="btn" onClick={onClose}>Done</button>
        </div>

        <label className="camera-setting-row">
          <div className="camera-setting-text">
            <span>Webcam on for recording</span>
            <small>Show and capture your live webcam feed while recording your routine.</small>
          </div>
          <input
            type="checkbox"
            className="camera-toggle"
            checked={webcamOn}
            onChange={(e) => {
              onWebcamToggle(e.target.checked);
              if (!e.target.checked) onStripToggle(false);
            }}
          />
        </label>

        <label className={`camera-setting-row ${!webcamOn ? "camera-setting-row--disabled" : ""}`}>
          <div className="camera-setting-text">
            <span>Remove webcam video from upload</span>
            <small>
              Your webcam is still shown during recording, but the video file is discarded after. Only the pose skeleton data is saved and uploaded.
              {!webcamOn && " (Enable webcam above to use this option.)"}
            </small>
          </div>
          <input
            type="checkbox"
            className="camera-toggle"
            checked={stripFromUpload}
            disabled={!webcamOn}
            onChange={(e) => onStripToggle(e.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}

export default function StudioPage({
  session,
  sessionFiles,
  onBack,
  onGoDashboard,
  onLogout,
  onUpdateSession,
  onUpdateSessionFiles,
  onPracticeRunComplete,
}) {
  const [phase, setPhase] = useState("idle");
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const [playCountdownRemaining, setPlayCountdownRemaining] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordingStartMs, setRecordingStartMs] = useState(0);
  const [localCountdown, setLocalCountdown] = useState(3);
  const [localDifficulty, setLocalDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [cameraState, setCameraState] = useState("requesting");
  const [poseState, setPoseState] = useState("loading");
  const [statusMessage, setStatusMessage] = useState("");
  const [compareActive, setCompareActive] = useState(false);
  const [comparePaused, setComparePaused] = useState(false);
  const [recordedFramesCount, setRecordedFramesCount] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [referenceVideoUrl, setReferenceVideoUrl] = useState("");
  const [showQuickSetup, setShowQuickSetup] = useState(true);
  const [playLayout, setPlayLayout] = useState("side-by-side");
  const [showPlayWebcam, setShowPlayWebcam] = useState(true);
  const [stripWebcamFromUpload, setStripWebcamFromUpload] = useState(false);
  const [showCameraSettings, setShowCameraSettings] = useState(false);
  const [showPlayerSettings, setShowPlayerSettings] = useState(false);
  const [routineData, setRoutineData] = useState(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [forcePlayUi, setForcePlayUi] = useState(false);
  const [showRecordBanner, setShowRecordBanner] = useState(
    () => session?.mode === "record" && !localStorage.getItem(LS_HIDE_RECORD_LIMIT_WARN)
  );
  const [liveScore, setLiveScore] = useState(null);
  const [avgScore, setAvgScore] = useState(null);
  const [practiceResultModal, setPracticeResultModal] = useState({
    open: false,
    summary: null,
    saving: false,
    saveError: "",
  });

  const videoRef = useRef(null);
  const referenceVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const refCanvasRef = useRef(null);
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
  const playLayoutRef = useRef("side-by-side");
  const showPlayWebcamRef = useRef(true);
  const recordingFramesRef = useRef([]);
  const recordingStartMsRef = useRef(0);
  const lastSampleMsRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const webcamChunksRef = useRef([]);
  const webcamMimeTypeRef = useRef("");
  const shouldCaptureWebcamRunRef = useRef(true);
  const composeCanvasRef = useRef(null);
  const composeRafRef = useRef(0);
  const composeActiveRef = useRef(false);
  const webcamRecordingStopLockRef = useRef(false);
  const playCountdownTimerRef = useRef(0);
  const practiceFinalizeLockRef = useRef(false);
  const scoreStatsRef = useRef({ total: 0, count: 0, best: 0, lastRenderMs: 0 });

  function resetScoring() {
    scoreStatsRef.current = { total: 0, count: 0, best: 0, lastRenderMs: 0 };
    setLiveScore(null);
    setAvgScore(null);
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
    }
  }

  function updateRecordSessionConfig(patch = {}) {
    if (!session || session.mode !== "record") return;
    const current = session.config && typeof session.config === "object" ? session.config : {};
    const next = {
      audioFileName: Object.prototype.hasOwnProperty.call(patch, "audioFileName")
        ? patch.audioFileName
        : (current.audioFileName || sessionFiles?.recordAudioFile?.name || ""),
      includeWebcamVideo: Object.prototype.hasOwnProperty.call(patch, "includeWebcamVideo")
        ? Boolean(patch.includeWebcamVideo)
        : Boolean(current.includeWebcamVideo),
      webcamLayout: Object.prototype.hasOwnProperty.call(patch, "webcamLayout")
        ? patch.webcamLayout
        : (current.webcamLayout || "raw"),
      difficulty: normalizeDifficulty(
        patch.difficulty,
        normalizeDifficulty(current.difficulty, localDifficulty)
      ),
    };
    setLocalDifficulty(next.difficulty);
    onUpdateSession(session.id, { config: next });
  }

  function handleAudioFileSelected(selected) {
    if (selected && selected.size > MAX_AUDIO_UPLOAD_BYTES) {
      setStatusMessage(`Audio file is too large. Max size is ${MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024)}MB.`);
      return;
    }
    onUpdateSessionFiles(session.id, { recordAudioFile: selected });
    updateRecordSessionConfig({ audioFileName: selected?.name || "" });
  }

  function clearPlayCountdownTimer() {
    if (playCountdownTimerRef.current) {
      clearInterval(playCountdownTimerRef.current);
      playCountdownTimerRef.current = 0;
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
    if (!shouldCaptureWebcamRunRef.current) return true;
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
      const recorderOptions = {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: WEBCAM_VIDEO_BITRATE,
        audioBitsPerSecond: WEBCAM_AUDIO_BITRATE,
      };
      const recorder = new MediaRecorder(captureStream, recorderOptions);
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

        if (discard || !chunks.length || !shouldCaptureWebcamRunRef.current) {
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
    setPlayCountdownRemaining(0);
    clearPlayCountdownTimer();
    setLocalCountdown(session.countdownSec || 3);
    setLocalDifficulty(normalizeDifficulty(session.config?.difficulty, DEFAULT_DIFFICULTY));
    setStatusMessage("");
    setCompareActive(false);
    setComparePaused(false);
    setPlayLayout("side-by-side");
    setShowPlayWebcam(true);
    setForcePlayUi(false);
    resetScoring();
    setRecordedFramesCount(0);
    setPracticeResultModal({ open: false, summary: null, completed: false, saving: false, saveError: "" });
    practiceFinalizeLockRef.current = false;
    recordingFramesRef.current = [];
    recordingStartMsRef.current = 0;
    lastSampleMsRef.current = 0;
    webcamChunksRef.current = [];
    webcamMimeTypeRef.current = "";
    shouldCaptureWebcamRunRef.current = true;
    webcamRecordingStopLockRef.current = false;
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    setShowQuickSetup(sessionFiles?.hideQuickSetup !== true);
  }, [session?.id, sessionFiles?.hideQuickSetup]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { compareActiveRef.current = compareActive; }, [compareActive]);
  useEffect(() => { routineRef.current = routineData; }, [routineData]);

  useEffect(() => {
    const nextMode =
      session?.mode === "load-routine" ||
        forcePlayUi ||
        (session?.mode === "record" && Boolean(routineData || sessionFiles?.generatedRoutine || sessionFiles?.loadedRoutine))
        ? "load-routine"
        : (session?.mode || "record");
    sessionModeRef.current = nextMode;
  }, [session?.mode, forcePlayUi, routineData, sessionFiles?.generatedRoutine, sessionFiles?.loadedRoutine]);

  useEffect(() => { playLayoutRef.current = playLayout; }, [playLayout]);
  useEffect(() => { showPlayWebcamRef.current = showPlayWebcam; }, [showPlayWebcam]);

  useEffect(() => {
    if (playLayout !== "side-by-side") return;
    if (referenceVideoUrl) return;
    setPlayLayout("side-by-side");
  }, [playLayout, referenceVideoUrl]);

  useEffect(() => {
    const sourceAudio =
      sessionFiles?.playAudioFile ||
      sessionFiles?.loadAudioFile ||
      sessionFiles?.recordAudioFile ||
      null;
    if (!sourceAudio) { setAudioUrl(""); return; }
    const nextUrl = URL.createObjectURL(sourceAudio);
    setAudioUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [sessionFiles?.playAudioFile, sessionFiles?.loadAudioFile, sessionFiles?.recordAudioFile, session?.id]);

  useEffect(() => {
    const sourceVideo = sessionFiles?.recordedWebcamFile || sessionFiles?.loadWebcamVideoFile || null;
    if (!sourceVideo) { setReferenceVideoUrl(""); return; }
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
        if (!fromFiles) { setRoutineData(null); return; }
        setRoutineData({
          ...fromFiles,
          difficulty: normalizeDifficulty(
            fromFiles?.difficulty,
            normalizeDifficulty(session?.config?.difficulty, DEFAULT_DIFFICULTY)
          ),
        });
        return;
      }

      const readyRoutine = sessionFiles?.generatedRoutine || sessionFiles?.loadedRoutine || null;
      if (readyRoutine) {
        const normalizedDifficulty = normalizeDifficulty(
          readyRoutine?.difficulty,
          normalizeDifficulty(session?.config?.difficulty, DEFAULT_DIFFICULTY)
        );
        const normalizedRoutine = { ...readyRoutine, difficulty: normalizedDifficulty };
        setRoutineData(normalizedRoutine);
        if (session?.config?.difficulty !== normalizedDifficulty) {
          onUpdateSession(session.id, { config: { ...(session.config || {}), difficulty: normalizedDifficulty } });
        }
        return;
      }

      const zipFile = sessionFiles?.loadZipFile;
      if (!zipFile) { setRoutineData(null); return; }

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
        const routineRaw = JSON.parse(routineText);
        const normalizedDifficulty = normalizeDifficulty(
          routineRaw?.difficulty,
          normalizeDifficulty(session?.config?.difficulty, DEFAULT_DIFFICULTY)
        );
        const routine = {
          ...(routineRaw && typeof routineRaw === "object" ? routineRaw : {}),
          difficulty: normalizedDifficulty,
        };
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
          audioFile = new File([audioBlob], basename(audioEntry.name), { type: audioBlob.type || "audio/mpeg" });
        }
        let webcamFile = null;
        if (webcamEntry) {
          const webcamBlob = await webcamEntry.async("blob");
          webcamFile = new File([webcamBlob], basename(webcamEntry.name), { type: webcamBlob.type || "video/webm" });
        }

        if (cancelled) return;
        setRoutineData(routine);
        onUpdateSession(session.id, { config: { ...(session.config || {}), difficulty: normalizedDifficulty } });
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
    return () => { cancelled = true; };
  }, [
    session?.id,
    session?.mode,
    sessionFiles?.generatedRoutine,
    sessionFiles?.loadedRoutine,
    sessionFiles?.loadZipFile,
    session?.config?.difficulty,
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
      const refCanvas = refCanvasRef.current;
      if (refCanvas && (refCanvas.width !== width || refCanvas.height !== height)) {
        refCanvas.width = width;
        refCanvas.height = height;
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
        (!showPlayWebcamRef.current || playLayoutRef.current === "none")
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
          const rawT = Number(audioRef.current.currentTime) || 0;
          if (durationSec > 0 && rawT >= durationSec) {
            finishCompareFlow();
          } else {
            const refT = durationSec > 0 ? rawT % durationSec : rawT;
            const activeDifficulty = normalizeDifficulty(
              routine?.difficulty,
              normalizeDifficulty(session?.config?.difficulty, DEFAULT_DIFFICULTY)
            );
            const params = difficultyParams(activeDifficulty);
            const refFrame = nearestFrameAtTime(routine, refT, params.windowSec);
            if (refFrame?.lm2d) {
              const layout = playLayoutRef.current;
              if (layout === "overlay") {
                drawPoseSkeleton(ctx, lm2dToLandmarks(refFrame.lm2d), canvas.width, canvas.height, "#60a5fa");
              } else if (layout === "skeleton-on-side") {
                const refCanvas = refCanvasRef.current;
                if (refCanvas) {
                  const refCtx = refCanvas.getContext("2d");
                  refCtx.clearRect(0, 0, refCanvas.width, refCanvas.height);
                  drawPoseSkeleton(refCtx, lm2dToLandmarks(refFrame.lm2d), refCanvas.width, refCanvas.height, "#60a5fa");
                }
              }
              const score = computeFrameScorePercent(refFrame, lastLandmarksRef.current, activeDifficulty);
              pushScoreSample(score, nowMs);
            }
          }
        }

        if (playLayoutRef.current !== "none") {
          drawPoseSkeleton(ctx, lastLandmarksRef.current, canvas.width, canvas.height, "#34d399");
        }
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
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
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
        try { await videoRef.current.play(); } catch {
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
      clearPlayCountdownTimer();
      stopSideBySideComposer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch {
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
          .catch(() => setStatusMessage("Recording started, but browser blocked audio playback."));
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
    if (phase !== "recording") return;
    if (elapsedSec < MAX_RECORDING_DURATION_SEC) return;
    setStatusMessage(`Recording stopped automatically at the ${MAX_RECORDING_DURATION_SEC}s limit.`);
    stopRecordingFlow();
  }, [phase, elapsedSec]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (phaseRef.current === "recording") {
        stopRecordingFlow();
        return;
      }
      if (compareActiveRef.current) {
        const endedDurationSec = Number(audio.currentTime || audio.duration || 0);
        compareActiveRef.current = false;
        setCompareActive(false);
        setComparePaused(false);
        if (referenceVideoRef.current) {
          referenceVideoRef.current.pause();
          referenceVideoRef.current.currentTime = 0;
        }
        finalizePracticeRun(true, endedDurationSec);
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
        try { refVideo.currentTime = audio.currentTime || 0; } catch {
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
    const shouldCaptureWebcam = Boolean(showPlayWebcam);
    const saveWebcam = shouldCaptureWebcam && !stripWebcamFromUpload;
    shouldCaptureWebcamRunRef.current = saveWebcam;
    setLocalCountdown(next);
    if (session?.config?.includeWebcamVideo !== saveWebcam) {
      updateRecordSessionConfig({ includeWebcamVideo: saveWebcam });
    }
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
      onUpdateSession(session.id, { status: "draft", lastRunSec: duration });
      onUpdateSessionFiles(session.id, {
        recordedWebcamFile: null,
        recordedWebcamLayout: session.config?.webcamLayout || "raw",
      });
      setStatusMessage("No pose detected in this run. Try again.");
      return;
    }

    const routine = buildRoutinePayload(session.title, recordingFramesRef.current, { difficulty: DEFAULT_DIFFICULTY });
    setRoutineData(routine);
    setPlayLayout("side-by-side");
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
        difficulty: DEFAULT_DIFFICULTY,
      },
    });
    setStatusMessage("Recording complete.");
    phaseRef.current = "idle";
  }

  function finalizePracticeRun(completed, durationOverrideSec = null) {
    if (practiceFinalizeLockRef.current) return;
    practiceFinalizeLockRef.current = true;

    const stats = scoreStatsRef.current;
    const samples = Number(stats?.count || 0);
    if (samples <= 0) {
      setStatusMessage(completed ? "Play session finished." : "Play stopped.");
      return;
    }

    const averageScore = roundN((stats.total || 0) / samples, 1);
    const bestScoreValue = roundN(stats.best || 0, 1);
    const durationSource = Number.isFinite(Number(durationOverrideSec))
      ? Number(durationOverrideSec)
      : Number(audioRef.current?.currentTime || routineData?.durationSec || 0);
    const durationSec = roundN(durationSource, 2);
    const summary = {
      sessionId: String(session?.id || ""),
      sessionTitle: String(session?.title || "Play Session"),
      averageScore,
      bestScore: bestScoreValue,
      samples,
      durationSec,
      grade: scoreToLetterGrade(averageScore),
      source: "play",
      difficulty: normalizeDifficulty(routineData?.difficulty, normalizeDifficulty(session?.config?.difficulty, DEFAULT_DIFFICULTY)),
    };

    setPracticeResultModal({
      open: true,
      summary,
      completed,
      saving: completed && typeof onPracticeRunComplete === "function",
      saveError: "",
    });
    setStatusMessage(completed ? "Play session finished." : "Play stopped.");

    if (completed && typeof onPracticeRunComplete === "function") {
      Promise.resolve(onPracticeRunComplete(summary))
        .then(() => setPracticeResultModal((prev) => ({ ...prev, saving: false, saveError: "" })))
        .catch((err) => {
          console.error("Stats save failed:", err);
          setPracticeResultModal((prev) => ({
            ...prev,
            saving: false,
            saveError: "Could not save stats to profile. Check your connection and try again.",
          }));
        });
    }
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
    const webcamFile = sessionFiles?.recordedWebcamFile || sessionFiles?.loadWebcamVideoFile || null;
    const packageName = `${safeRoutineName(session.title)}-package.zip`;
    const routineExport = {
      ...existingRoutine,
      difficulty: normalizeDifficulty(
        existingRoutine?.difficulty,
        normalizeDifficulty(session?.config?.difficulty, DEFAULT_DIFFICULTY)
      ),
      song: {
        ...(existingRoutine.song || {}),
        offsetSec: Number(existingRoutine.song?.offsetSec) || 0,
      },
    };
    if (audioFile?.name) routineExport.song.fileName = sanitizeFilename(audioFile.name);
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
      if (audioFile) zip.file(sanitizeFilename(audioFile.name), audioFile);
      if (webcamFile) zip.file(sanitizeFilename(webcamFile.name), webcamFile);

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
          difficulty: normalizeDifficulty(routineExport?.difficulty, DEFAULT_DIFFICULTY),
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

  function startComparePlayback() {
    if (!audioRef.current) return;
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
        setStatusMessage("Play started.");
      })
      .catch(() => {
        setCompareActive(false);
        compareActiveRef.current = false;
        setStatusMessage("Play session could not start audio playback.");
      });
  }

  function startCompareFlow() {
    if (playCountdownRemaining > 0) return;
    if (!routineData || !Array.isArray(routineData.frames) || routineData.frames.length === 0) {
      setStatusMessage("No routine frames found for compare.");
      return;
    }
    if (!audioRef.current || !audioUrl) {
      setStatusMessage("No audio file found for this play session.");
      return;
    }

    clearPlayCountdownTimer();
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    if (referenceVideoRef.current) {
      referenceVideoRef.current.pause();
      referenceVideoRef.current.currentTime = 0;
    }
    setComparePaused(false);
    practiceFinalizeLockRef.current = false;
    setPracticeResultModal({ open: false, summary: null, completed: false, saving: false, saveError: "" });
    resetScoring();

    const next = Math.max(1, Math.min(30, Number(localCountdown) || 3));
    setLocalCountdown(next);
    setPlayCountdownRemaining(next);
    setStatusMessage(`Counting down... ${next}`);

    let remaining = next;
    playCountdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearPlayCountdownTimer();
        setPlayCountdownRemaining(0);
        startComparePlayback();
        return;
      }
      setPlayCountdownRemaining(remaining);
      setStatusMessage(`Counting down... ${remaining}`);
    }, 1000);
  }

  function cancelCountdown() {
    clearPlayCountdownTimer();
    setPlayCountdownRemaining(0);
    compareActiveRef.current = false;
    setCompareActive(false);
    setComparePaused(false);
    setStatusMessage("Play countdown cancelled.");
  }

  function pauseCompareFlow() {
    if (!compareActiveRef.current) return;
    compareActiveRef.current = false;
    setCompareActive(false);
    setComparePaused(true);
    if (audioRef.current) audioRef.current.pause();
    if (referenceVideoRef.current) referenceVideoRef.current.pause();
    setStatusMessage("Paused.");
  }

  function resumeCompareFlow() {
    if (!comparePaused || !audioRef.current) return;
    audioRef.current
      .play()
      .then(() => {
        if (playLayout === "side-by-side" && referenceVideoRef.current && referenceVideoUrl) {
          referenceVideoRef.current.play().catch(() => {});
        }
        setComparePaused(false);
        setCompareActive(true);
        compareActiveRef.current = true;
        setStatusMessage("Resumed.");
      })
      .catch(() => {
        setStatusMessage("Could not resume playback.");
      });
  }

  function stopCompareFlow() {
    const stoppedDurationSec = Number(audioRef.current?.currentTime || 0);
    clearPlayCountdownTimer();
    setPlayCountdownRemaining(0);
    compareActiveRef.current = false;
    setCompareActive(false);
    setComparePaused(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (referenceVideoRef.current) {
      referenceVideoRef.current.pause();
      referenceVideoRef.current.currentTime = 0;
    }
    practiceFinalizeLockRef.current = false;
    finalizePracticeRun(false, stoppedDurationSec);
  }

  function finishCompareFlow() {
    const finishedDurationSec = Number(audioRef.current?.currentTime || routineData?.durationSec || 0);
    compareActiveRef.current = false;
    setCompareActive(false);
    setComparePaused(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (referenceVideoRef.current) {
      referenceVideoRef.current.pause();
      referenceVideoRef.current.currentTime = 0;
    }
    finalizePracticeRun(true, finishedDurationSec);
  }

  const isPlayUiMode =
    session.mode === "load-routine" ||
    forcePlayUi ||
    (session.mode === "record" && Boolean(routineData || sessionFiles?.generatedRoutine || sessionFiles?.loadedRoutine));
  const isRecordUiMode = session.mode === "record" && !isPlayUiMode;
  const activeDifficulty = normalizeDifficulty(session?.config?.difficulty, localDifficulty);
  const hasReferenceWebcamVideo = Boolean(sessionFiles?.recordedWebcamFile || sessionFiles?.loadWebcamVideoFile);
  const canUseSideBySide = hasReferenceWebcamVideo && Boolean(referenceVideoUrl);
  const isSideBySidePlay = isPlayUiMode && playLayout === "side-by-side" && !!referenceVideoUrl;
  const isSkeletonSplitPlay = isPlayUiMode && playLayout === "skeleton-on-side";
  const isSplitLayout = isSideBySidePlay || isSkeletonSplitPlay;
  const studioGridClass = [
    "studio-grid",
    isPlayUiMode ? "play-mode" : "",
    isRecordUiMode ? "record-mode" : "",
    isSplitLayout ? "split-preview-row" : "",
    showQuickSetup ? "" : "no-setup",
  ].filter(Boolean).join(" ");
  const appRootClassName = isPlayUiMode || isRecordUiMode ? "app-root app-root-play" : "app-root";
  const shownModeLabel = isPlayUiMode ? modeLabel("load-routine") : modeLabel(session.mode);

  return (
    <div className={appRootClassName}>
      <header className={`topbar ${isRecordUiMode ? "topbar--record" : "topbar--play"}`}>
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
      {showRecordBanner && isRecordUiMode && (
        <RecordingLimitBanner onClose={() => setShowRecordBanner(false)} />
      )}

      <section className="studio-wrap">
        <div className={studioGridClass}>
          {isPlayUiMode ? (
            <article className="studio-card">
              <h3>Play Session</h3>
              <p className="meta-line">
                Routine: {routineData?.name || "N/A"} | Frames: {routineData?.frames?.length || 0} | Duration:{" "}
                {(Number(routineData?.durationSec) || 0).toFixed(2)}s
              </p>
              <p className="meta-line">Difficulty: {difficultyLabel(activeDifficulty)}</p>
              <label className="field">
                Countdown (1-30 sec)
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={localCountdown}
                  onChange={(e) => setLocalCountdown(e.target.value)}
                  disabled={compareActive || comparePaused || playCountdownRemaining > 0}
                />
              </label>
              <div className="studio-actions">
                {!compareActive && !comparePaused && playCountdownRemaining <= 0 && (
                  <button className="btn btn-primary" onClick={startCompareFlow}>Start Play</button>
                )}
                {playCountdownRemaining > 0 && (
                  <button className="btn btn-danger" onClick={cancelCountdown}>Cancel</button>
                )}
                {compareActive && playCountdownRemaining <= 0 && (
                  <button className="btn" onClick={pauseCompareFlow}>Pause</button>
                )}
                {comparePaused && (
                  <>
                    <button className="btn btn-primary" onClick={resumeCompareFlow}>Resume</button>
                    <button className="btn btn-danger" onClick={stopCompareFlow}>Stop</button>
                  </>
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
                      onChange={(e) => handleAudioFileSelected(e.target.files?.[0] || null)}
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
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowPlayWebcam(checked);
                        updateRecordSessionConfig({ includeWebcamVideo: checked });
                      }}
                      disabled={phase !== "idle"}
                    />
                    Include webcam video in exported package (optional)
                  </label>

                  {Boolean(session.config?.includeWebcamVideo) && (
                    <label className="field">
                      Webcam Layout
                      <select
                        value={session.config?.webcamLayout || "raw"}
                        onChange={(e) => updateRecordSessionConfig({ includeWebcamVideo: true, webcamLayout: e.target.value })}
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
                      <button className="btn btn-primary" onClick={startRecordingFlow}>Start Recording</button>
                    )}
                    {phase === "countdown" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>Cancel</button>
                    )}
                    {phase === "recording" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>Stop Recording</button>
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
            <div className={isSplitLayout ? "fake-stage split" : "fake-stage"}>
              <div
                className={
                  (isPlayUiMode || isRecordUiMode) && (!showPlayWebcam || playLayout === "none")
                    ? "stage-live play-skeleton"
                    : "stage-live"
                }
              >
                <video ref={videoRef} className="stage-video" autoPlay playsInline muted />
                <canvas ref={canvasRef} className="stage-canvas" />
                {isRecordUiMode && phase === "countdown" && <div className="count-badge center">{countdownRemaining}</div>}
                {isPlayUiMode && playCountdownRemaining > 0 && <div className="count-badge center">{playCountdownRemaining}</div>}
                {isRecordUiMode && phase === "recording" && <div className="rec-pill">REC {elapsedSec.toFixed(1)}s</div>}
              </div>
              {isSideBySidePlay && (
                <div className="stage-reference">
                  <video ref={referenceVideoRef} className="stage-video" src={referenceVideoUrl} playsInline muted />
                </div>
              )}
              {isSkeletonSplitPlay && (
                <div className="stage-reference stage-reference--skeleton">
                  <canvas ref={refCanvasRef} className="stage-canvas stage-canvas--ref" />
                </div>
              )}
              {isPlayUiMode && (
                <>
                  <div className="play-info-chip">
                    <strong>{routineData?.name || "Play Session"}</strong>
                    <small>
                      {(Number(routineData?.durationSec) || 0).toFixed(2)}s | {routineData?.frames?.length || 0} frames | Difficulty: {difficultyLabel(activeDifficulty)}
                    </small>
                    <small className="score-line">
                      Score: {liveScore == null ? "--" : `${liveScore.toFixed(1)}%`} | Avg: {avgScore == null ? "--" : `${avgScore.toFixed(1)}%`}
                    </small>
                  </div>
                  <div className="floating-play-dock" role="group" aria-label="Play controls">
                    <span className="dock-mode-badge dock-mode-badge--play">PLAY MODE</span>
                    <span className="dock-sep" aria-hidden="true" />
                    {!compareActive && !comparePaused && playCountdownRemaining <= 0 && (
                      <button className="btn btn-primary" onClick={startCompareFlow}>Start</button>
                    )}
                    {playCountdownRemaining > 0 && (
                      <button className="btn btn-danger" onClick={cancelCountdown}>Cancel</button>
                    )}
                    {compareActive && playCountdownRemaining <= 0 && (
                      <button className="btn" onClick={pauseCompareFlow}>Pause</button>
                    )}
                    {comparePaused && (
                      <>
                        <button className="btn btn-primary" onClick={resumeCompareFlow}>Resume</button>
                        <button className="btn btn-danger" onClick={stopCompareFlow}>Stop</button>
                      </>
                    )}
                    <button className="btn" onClick={downloadPackage} disabled={downloadPending}>
                      {downloadPending ? "Preparing..." : "Download"}
                    </button>
                    <label className="dock-countdown">
                      <span>Countdown</span>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={localCountdown}
                        onChange={(e) => setLocalCountdown(e.target.value)}
                        disabled={compareActive || comparePaused || playCountdownRemaining > 0}
                      />
                    </label>
                    <span className="dock-sep" aria-hidden="true" />
                    <button className="btn" onClick={() => setShowPlayerSettings(true)} disabled={compareActive || comparePaused || playCountdownRemaining > 0}>
                      Player Settings
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
                    <small>Audio: {sessionFiles?.recordAudioFile?.name || "Required"}</small>
                    <small>
                      Countdown: {Math.max(1, Math.min(30, Number(localCountdown) || 3))}s | Camera: {showPlayWebcam ? (stripWebcamFromUpload ? "On (not saved)" : "On") : "Off"}
                    </small>
                  </div>
                  <div className="floating-play-dock" role="group" aria-label="Record controls">
                    <span className="dock-mode-badge dock-mode-badge--record">REC MODE</span>
                    <span className="dock-sep" aria-hidden="true" />
                    <label className={phase !== "idle" ? "btn dock-file-btn disabled" : "btn dock-file-btn"}>
                      {sessionFiles?.recordAudioFile ? "Audio" : "Insert Audio"}
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => handleAudioFileSelected(e.target.files?.[0] || null)}
                        disabled={phase !== "idle"}
                      />
                    </label>
                    <button className="btn" onClick={() => setShowCameraSettings(true)} disabled={phase !== "idle"}>
                      Camera Settings
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
                      <button className="btn btn-primary" onClick={startRecordingFlow}>Start</button>
                    )}
                    {phase === "countdown" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>Cancel</button>
                    )}
                    {phase === "recording" && (
                      <button className="btn btn-danger" onClick={stopRecordingFlow}>Stop</button>
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
      </section>
      {showPlayerSettings && (
        <PlayerSettingsPopup
          playLayout={playLayout}
          difficulty={localDifficulty}
          webcamOn={showPlayWebcam}
          canUseSideBySide={canUseSideBySide}
          onLayoutChange={(v) => setPlayLayout(v)}
          onDifficultyChange={(v) => { setLocalDifficulty(v); updateRecordSessionConfig({ difficulty: v }); }}
          onWebcamToggle={(v) => setShowPlayWebcam(v)}
          onClose={() => setShowPlayerSettings(false)}
        />
      )}
      {showCameraSettings && (
        <CameraSettingsPopup
          webcamOn={showPlayWebcam}
          stripFromUpload={stripWebcamFromUpload}
          onWebcamToggle={(v) => setShowPlayWebcam(v)}
          onStripToggle={(v) => setStripWebcamFromUpload(v)}
          onClose={() => setShowCameraSettings(false)}
        />
      )}
      {practiceResultModal.open && practiceResultModal.summary && (
        <PracticeRunSummaryModal
          summary={practiceResultModal.summary}
          completed={practiceResultModal.completed}
          saving={practiceResultModal.saving}
          saveError={practiceResultModal.saveError}
          onClose={() => setPracticeResultModal((prev) => ({ ...prev, open: false }))}
        />
      )}
    </div>
  );
}
