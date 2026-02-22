const { useEffect, useMemo, useState } = React;

const STORAGE_KEY = "justdance_frontend_test_sessions_v2";

const MODE_OPTIONS = [
  { id: "record", label: "Recording Session", hint: "Create a routine from webcam recording." },
  { id: "load-routine", label: "Load Routine Package", hint: "Load an existing zip package to practice." },
  { id: "create-video", label: "Create From Video", hint: "Generate a routine from an uploaded dance video." },
];

const WEBCAM_LAYOUT_OPTIONS = [
  { id: "raw", label: "Raw Webcam" },
  { id: "side-by-side", label: "Side-By-Side" },
];

function modeLabel(mode) {
  return MODE_OPTIONS.find((item) => item.id === mode)?.label || mode;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function defaultDraft() {
  return {
    title: "",
    mode: "record",
    recordAudioFileName: "",
    recordIncludeWebcamVideo: false,
    recordWebcamLayout: "raw",
    loadZipFileName: "",
    createVideoFileName: "",
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
  if (mode === "load-routine") return "Routine Package";
  if (mode === "create-video") return "Video Conversion";
  return "Studio Session";
}

function draftValidationError(draft) {
  if (draft.mode === "record" && !draft.recordAudioFileName) {
    return "Recording mode requires an audio file.";
  }
  if (draft.mode === "load-routine") {
    if (!draft.loadZipFileName) return "Loading mode requires a zip package.";
    if (!draft.loadZipFileName.toLowerCase().endsWith(".zip")) return "Package file must be a .zip file.";
  }
  if (draft.mode === "create-video" && !draft.createVideoFileName) {
    return "Create-from-video mode requires a video file.";
  }
  return "";
}

function basename(path) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || "";
}

function isLikelyAudioFileName(name) {
  return /\\.(mp3|wav|m4a|ogg|aac|flac|webm)$/i.test(String(name || ""));
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
      requiredContents: ["routine.json", "audio file"],
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
    return `Audio: ${session.config.audioFileName} | ${webcam}`;
  }
  if (session.mode === "load-routine") {
    return `Package: ${session.config.packageZipFileName} (needs routine.json + audio)`;
  }
  if (session.mode === "create-video") {
    return `Video: ${session.config.videoFileName}`;
  }
  return "";
}

function App() {
  const [view, setView] = useState("main");
  const [mainTab, setMainTab] = useState("dashboard");
  const [sessions, setSessions] = useState(loadStoredSessions);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const metrics = useMemo(() => {
    const total = sessions.length;
    const completed = sessions.filter((s) => s.status === "completed").length;
    const recording = sessions.filter((s) => s.mode === "record").length;
    const loading = sessions.filter((s) => s.mode === "load-routine").length;
    const fromVideo = sessions.filter((s) => s.mode === "create-video").length;
    return { total, completed, recording, loading, fromVideo };
  }, [sessions]);

  function openCreateModal() {
    setDraft(defaultDraft());
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
  }

  function createSession() {
    const err = draftValidationError(draft);
    if (err) {
      return;
    }
    const session = buildSessionFromDraft(draft);
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setView("studio");
    closeCreateModal();
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

  function deleteSession(sessionId) {
    setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setView("main");
    }
  }

  function openSessionInStudio(sessionId) {
    setActiveSessionId(sessionId);
    setView("studio");
  }

  function returnToMain() {
    setView("main");
    setMainTab("library");
  }

  if (view === "studio") {
    return (
      <StudioPage
        session={activeSession}
        onBack={returnToMain}
        onUpdateSession={updateSession}
      />
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Frontend Test Space</p>
          <h1>JustDance Creator Console</h1>
        </div>
        <button className="btn btn-primary" onClick={openCreateModal}>
          + Add Session
        </button>
      </header>

      <nav className="tabs" aria-label="Main tabs">
        <button className={mainTab === "dashboard" ? "tab active" : "tab"} onClick={() => setMainTab("dashboard")}>Dashboard</button>
        <button className={mainTab === "library" ? "tab active" : "tab"} onClick={() => setMainTab("library")}>My Library</button>
      </nav>

      <main className="content">
        {mainTab === "dashboard" && (
          <Dashboard sessions={sessions} metrics={metrics} onOpenSession={openSessionInStudio} />
        )}

        {mainTab === "library" && (
          <Library
            sessions={sessions}
            onOpenSession={openSessionInStudio}
            onDeleteSession={deleteSession}
            onAddSession={openCreateModal}
          />
        )}
      </main>

      {showCreateModal && (
        <CreateSessionModal
          draft={draft}
          setDraft={setDraft}
          onClose={closeCreateModal}
          onSubmit={createSession}
        />
      )}
    </div>
  );
}

function Dashboard({ sessions, metrics, onOpenSession }) {
  const recent = sessions.slice(0, 4);
  return (
    <section className="panel-grid">
      <article className="metric-card">
        <h3>Total Sessions</h3>
        <p className="metric-value">{metrics.total}</p>
      </article>
      <article className="metric-card">
        <h3>Completed Runs</h3>
        <p className="metric-value">{metrics.completed}</p>
      </article>
      <article className="metric-card">
        <h3>Recording Configs</h3>
        <p className="metric-value">{metrics.recording}</p>
      </article>
      <article className="metric-card">
        <h3>Load Package Configs</h3>
        <p className="metric-value">{metrics.loading}</p>
      </article>

      <article className="list-card wide">
        <h3>Recent Sessions</h3>
        {recent.length === 0 && <p className="muted">No sessions yet. Create one from My Library.</p>}
        {recent.map((session) => (
          <button key={session.id} className="recent-row" onClick={() => onOpenSession(session.id)}>
            <span>{session.title}</span>
            <small>{formatDateTime(session.updatedAt)}</small>
          </button>
        ))}
      </article>
    </section>
  );
}

function Library({ sessions, onOpenSession, onDeleteSession, onAddSession }) {
  return (
    <section className="library-wrap">
      <div className="section-head">
        <h2>My Library</h2>
        <button className="btn btn-primary" onClick={onAddSession}>+ Add</button>
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
            </div>
            <div className="session-actions">
              <button className="btn" onClick={() => onOpenSession(session.id)}>Open Studio</button>
              <button className="btn btn-danger" onClick={() => onDeleteSession(session.id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StudioPage({ session, onBack, onUpdateSession }) {
  const [phase, setPhase] = useState("idle");
  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordingStartMs, setRecordingStartMs] = useState(0);
  const [localCountdown, setLocalCountdown] = useState(3);

  useEffect(() => {
    if (!session) return;
    setPhase("idle");
    setElapsedSec(0);
    setCountdownRemaining(0);
    setLocalCountdown(session.countdownSec || 3);
  }, [session?.id]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdownRemaining <= 0) {
      setPhase("recording");
      setRecordingStartMs(performance.now());
      return;
    }
    const t = setTimeout(() => setCountdownRemaining((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdownRemaining]);

  useEffect(() => {
    if (phase !== "recording") return;
    const interval = setInterval(() => {
      setElapsedSec((performance.now() - recordingStartMs) / 1000);
    }, 120);
    return () => clearInterval(interval);
  }, [phase, recordingStartMs]);

  if (!session) {
    return (
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Studio</p>
            <h1>No Session Selected</h1>
          </div>
          <button className="btn" onClick={onBack}>Back To Library</button>
        </header>
        <section className="studio-empty">
          <p className="muted">Open a session from My Library first.</p>
        </section>
      </div>
    );
  }

  function saveCountdown() {
    const next = Math.max(1, Math.min(30, Number(localCountdown) || 3));
    setLocalCountdown(next);
    onUpdateSession(session.id, { countdownSec: next });
  }

  function startRecordingFlow() {
    const next = Math.max(1, Math.min(30, Number(localCountdown) || 3));
    setLocalCountdown(next);
    onUpdateSession(session.id, { countdownSec: next, status: "armed" });
    setElapsedSec(0);
    setCountdownRemaining(next);
    setPhase("countdown");
  }

  function stopRecordingFlow() {
    setPhase("idle");
    const duration = Math.max(0, elapsedSec);
    onUpdateSession(session.id, {
      status: "completed",
      lastRunSec: duration,
      runs: (session.runs || 0) + 1,
    });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Studio</p>
          <h1>{session.title}</h1>
          <p className="muted">{modeLabel(session.mode)}</p>
        </div>
        <button className="btn" onClick={onBack}>Back To Library</button>
      </header>

      <section className="studio-wrap">
        <div className="studio-grid">
          <article className="studio-card">
            <h3>Session Inputs</h3>
            <p className="meta-line">{describeSessionConfig(session)}</p>
            {session.mode === "load-routine" && (
              <p className="meta-line">Package must include: routine.json + audio. Webcam video is optional.</p>
            )}
          </article>

          {session.mode === "record" ? (
            <article className="studio-card">
              <h3>Recording Controls</h3>
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
                <button className="btn btn-primary" disabled={phase !== "idle"} onClick={startRecordingFlow}>
                  Start Record
                </button>
                <button className="btn btn-danger" disabled={phase !== "recording"} onClick={stopRecordingFlow}>
                  Stop
                </button>
                <button className="btn" disabled={phase !== "idle"} onClick={saveCountdown}>
                  Save Countdown
                </button>
              </div>

              <div className="studio-state">
                {phase === "idle" && <p>Ready</p>}
                {phase === "countdown" && <p>Countdown: {countdownRemaining}</p>}
                {phase === "recording" && <p>Recording: {elapsedSec.toFixed(1)}s</p>}
              </div>
            </article>
          ) : (
            <article className="studio-card">
              <h3>Mode Note</h3>
              <p className="meta-line">
                {session.mode === "load-routine" && "Load mode does not need countdown or output capture settings."}
                {session.mode === "create-video" && "Create-from-video mode only needs a video input in config."}
              </p>
            </article>
          )}

          <article className="studio-canvas">
            <div className="fake-stage">
              {session.mode === "record" && phase === "countdown" && <div className="count-badge">{countdownRemaining}</div>}
              {session.mode === "record" && phase === "recording" && <div className="rec-pill">REC {elapsedSec.toFixed(1)}s</div>}
              <p>Studio runtime page placeholder</p>
              <small>Wire your MediaPipe capture workflow here.</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function CreateSessionModal({ draft, setDraft, onClose, onSubmit }) {
  const [loadZipCheck, setLoadZipCheck] = useState({ status: "idle", message: "" });
  const validationError = draftValidationError(draft);

  useEffect(() => {
    if (draft.mode !== "load-routine") {
      setLoadZipCheck({ status: "idle", message: "" });
    }
  }, [draft.mode]);

  function onModeChange(nextMode) {
    setDraft((prev) => ({
      ...prev,
      mode: nextMode,
      recordAudioFileName: nextMode === "record" ? prev.recordAudioFileName : "",
      loadZipFileName: nextMode === "load-routine" ? prev.loadZipFileName : "",
      createVideoFileName: nextMode === "create-video" ? prev.createVideoFileName : "",
    }));
  }

  async function validateLoadZipFile(file) {
    if (!file) {
      setLoadZipCheck({ status: "idle", message: "" });
      return;
    }
    setLoadZipCheck({ status: "checking", message: "Validating zip contents..." });

    try {
      const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      const hasRoutineJson = entries.some((entry) => basename(entry.name).toLowerCase() === "routine.json");
      const hasAudioFile = entries.some((entry) => isLikelyAudioFileName(basename(entry.name)));

      if (!hasRoutineJson || !hasAudioFile) {
        const parts = [];
        if (!hasRoutineJson) parts.push("routine.json");
        if (!hasAudioFile) parts.push("audio file");
        setLoadZipCheck({
          status: "invalid",
          message: `Zip is missing required content: ${parts.join(" + ")}.`,
        });
        return;
      }

      setLoadZipCheck({
        status: "valid",
        message: "Zip is valid (routine.json + audio file found).",
      });
    } catch {
      setLoadZipCheck({
        status: "invalid",
        message: "Unable to read zip file. Use a valid .zip package.",
      });
    }
  }

  const zipValidationError =
    draft.mode === "load-routine" &&
    draft.loadZipFileName &&
    loadZipCheck.status !== "valid"
      ? loadZipCheck.message || "Zip package validation failed."
      : "";

  const submitError = validationError || zipValidationError;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>New Session Config</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <label className="field">
          Session Title
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Optional"
          />
        </label>

        <div className="mode-list">
          {MODE_OPTIONS.map((mode) => (
            <label key={mode.id} className={draft.mode === mode.id ? "mode-item active" : "mode-item"}>
              <input
                type="radio"
                name="mode"
                checked={draft.mode === mode.id}
                onChange={() => onModeChange(mode.id)}
              />
              <span>
                <strong>{mode.label}</strong>
                <small>{mode.hint}</small>
              </span>
            </label>
          ))}
        </div>

        {draft.mode === "record" && (
          <>
            <label className="field">
              Required Audio Input
              <input
                type="file"
                accept="audio/*"
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    recordAudioFileName: e.target.files?.[0]?.name || "",
                  }))
                }
              />
              {draft.recordAudioFileName && <small className="muted">Selected: {draft.recordAudioFileName}</small>}
            </label>

            <label className="field checkbox-row">
              <input
                type="checkbox"
                checked={draft.recordIncludeWebcamVideo}
                onChange={(e) => setDraft((prev) => ({ ...prev, recordIncludeWebcamVideo: e.target.checked }))}
              />
              Include webcam video in output file (optional)
            </label>

            {draft.recordIncludeWebcamVideo && (
              <label className="field">
                Webcam Output Layout
                <select
                  value={draft.recordWebcamLayout}
                  onChange={(e) => setDraft((prev) => ({ ...prev, recordWebcamLayout: e.target.value }))}
                >
                  {WEBCAM_LAYOUT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {draft.mode === "load-routine" && (
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
                  }));
                  await validateLoadZipFile(selected);
                }}
              />
              {draft.loadZipFileName && <small className="muted">Selected: {draft.loadZipFileName}</small>}
            </label>
            <p className="meta-line">ZIP must contain `routine.json` and an audio file. Webcam video is optional.</p>
            {loadZipCheck.message && (
              <p className="meta-line" style={{ color: loadZipCheck.status === "valid" ? "#73e7bf" : "#ff9298" }}>
                {loadZipCheck.message}
              </p>
            )}
          </>
        )}

        {draft.mode === "create-video" && (
          <label className="field">
            Required Video Input
            <input
              type="file"
              accept="video/*"
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  createVideoFileName: e.target.files?.[0]?.name || "",
                }))
              }
            />
            {draft.createVideoFileName && <small className="muted">Selected: {draft.createVideoFileName}</small>}
          </label>
        )}

        {submitError && <p className="meta-line" style={{ color: "#ff9298" }}>{submitError}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={Boolean(submitError)}>
            Create And Open Studio
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
