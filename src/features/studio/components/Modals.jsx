import React, { useRef, useState } from "react";
import {
  MAX_RECORDINGS_PER_USER,
  MAX_RECORDING_DURATION_SEC,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SEC,
  DIFFICULTY_OPTIONS,
  LS_HIDE_RECORD_LIMIT_WARN,
} from "../constants";
import { normalizeDifficulty, importValidationError, scoreToLetterGrade, defaultImportDraft } from "../utils";
import { getVideoDurationSec, trimVideoWithFFmpeg } from "../pose";

export function PracticeRunSummaryModal({ summary, completed, saving, saveError, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal practice-summary-modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>{completed ? "Practice Complete" : "Session Stopped"}</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        {!completed && (
          <p className="meta-line practice-incomplete-notice">
            You stopped early. This result was not saved.
          </p>
        )}
        <div className="practice-grade-row">
          <div>
            <p className="muted">Average Score</p>
            <h3>{Number(summary.averageScore || 0).toFixed(1)}%</h3>
          </div>
          <div className={`grade-badge${!completed ? " grade-badge--muted" : ""}`}>{summary.grade || scoreToLetterGrade(summary.averageScore)}</div>
        </div>
        <div className="stats-grid practice-grid">
          <article className="stats-item">
            <p className="muted">Scored Frames</p>
            <h3>{Number(summary.samples || 0)}</h3>
          </article>
          <article className="stats-item">
            <p className="muted">Duration</p>
            <h3>{Number(summary.durationSec || 0).toFixed(2)}s</h3>
          </article>
        </div>
        {completed && saving && <p className="meta-line">Saving to your profile...</p>}
        {completed && !saving && !saveError && <p className="meta-line">Saved to profile.</p>}
        {completed && saveError && <p className="meta-line practice-error">{saveError}</p>}
      </div>
    </div>
  );
}

export function LibraryLimitModal({ onClose, onGoLibrary }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Library Full</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p>You've reached the {MAX_RECORDINGS_PER_USER}-recording limit. To add something new, delete one of your existing recordings first.</p>
        <div className="studio-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => { onClose(); onGoLibrary(); }}>Go to My Library</button>
          <button className="btn" onClick={onClose}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

export function RecordingLimitBanner({ onClose }) {
  const [hide, setHide] = useState(false);

  function dismiss(permanently) {
    if (permanently) {
      localStorage.setItem(LS_HIDE_RECORD_LIMIT_WARN, "1");
    }
    setHide(true);
    onClose();
  }

  if (hide) return null;

  return (
    <div className="limit-banner" role="alert">
      <span>Recordings are limited to {MAX_RECORDING_DURATION_SEC} seconds.</span>
      <label className="limit-banner-check">
        <input type="checkbox" onChange={(e) => { if (e.target.checked) dismiss(true); }} />
        Don't show again
      </label>
      <button className="btn limit-banner-close" onClick={() => dismiss(false)} aria-label="Dismiss">✕</button>
    </div>
  );
}

export function ImportSessionModal({ draft, setDraft, onClose, onSubmit }) {
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [videoWarning, setVideoWarning] = useState(null);
  const [fileSizeError, setFileSizeError] = useState("");
  const ffmpegRef = useRef(null);
  const validationError = importValidationError(draft);
  const submitError = fileSizeError || validationError;

  async function onVideoFileChange(file) {
    setFileSizeError("");
    setVideoWarning(null);
    if (!file) {
      setDraft((prev) => ({ ...prev, sourceVideoFileName: "", sourceVideoFile: null }));
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setFileSizeError(`File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 100 MB.`);
      setDraft((prev) => ({ ...prev, sourceVideoFileName: "", sourceVideoFile: null }));
      return;
    }
    setDraft((prev) => ({ ...prev, sourceVideoFileName: file.name, sourceVideoFile: file }));
    try {
      const dur = await getVideoDurationSec(file);
      if (dur > MAX_VIDEO_SEC) {
        setVideoWarning({ durationSec: dur });
      }
    } catch {
      // non-fatal, warn at submit if needed
    }
  }

  function onModeChange(nextMode) {
    setDraft((prev) => ({
      ...prev,
      importMode: nextMode,
      sourceVideoFileName: nextMode === "load-video" ? prev.sourceVideoFileName : "",
      sourceVideoFile: nextMode === "load-video" ? prev.sourceVideoFile : null,
      sourceVideoDifficulty: nextMode === "load-video"
        ? normalizeDifficulty(prev.sourceVideoDifficulty)
        : "medium",
      friendShareCode: nextMode === "friend-code" ? prev.friendShareCode : "",
    }));
  }

  async function handleSubmit(confirmed = false) {
    if (submitError || busy) return;
    if (videoWarning && !confirmed) return;
    setVideoWarning(null);
    setBusy(true);
    setProgressMessage("");
    try {
      await onSubmit(draft, (msg) => setProgressMessage(msg || ""), ffmpegRef);
    } catch (err) {
      if (err?.message !== "cancelled") {
        setProgressMessage(err?.message || "Import failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    if (ffmpegRef.current) {
      try { ffmpegRef.current.terminate(); } catch {}
      ffmpegRef.current = null;
    }
    setBusy(false);
    setProgressMessage("");
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Import Session</h2>
          <button className="btn" onClick={handleCancel}>Close</button>
        </div>

        <label className="field">
          Session Title
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Name your session"
            disabled={busy}
          />
        </label>

        <div className="mode-list">
          {[
            { id: "load-video", label: "Load From Video", hint: "Convert a video into a recording and open Play session." },
            { id: "friend-code", label: "Friend's Video", hint: "Enter a friend's share code to import their session." },
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

        {draft.importMode === "load-video" && (
          <>
            <label className="field">
              Source Video File
              <input
                type="file"
                accept="video/*"
                onChange={(e) => onVideoFileChange(e.target.files?.[0] || null)}
                disabled={busy}
              />
              {draft.sourceVideoFileName && <small className="muted">Selected: {draft.sourceVideoFileName}</small>}
            </label>
            {videoWarning && (
              <div className="share-settings-dirty" style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 6px" }}>
                  This video is {(videoWarning.durationSec / 60).toFixed(1)} minutes long. Only the first 2 minutes will be used.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  In-browser trimming can take a long time depending on file size and your device. It is strongly recommended to manually trim the video to under 2 minutes before importing.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => handleSubmit(true)} disabled={busy}>Continue anyway</button>
                  <button className="btn" onClick={() => { setVideoWarning(null); setDraft((prev) => ({ ...prev, sourceVideoFileName: "", sourceVideoFile: null })); }}>Cancel</button>
                </div>
              </div>
            )}
            <label className="field">
              Difficulty
              <select
                value={normalizeDifficulty(draft.sourceVideoDifficulty)}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    sourceVideoDifficulty: normalizeDifficulty(e.target.value),
                  }))
                }
                disabled={busy}
              >
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <small className="muted">Easy is more lenient. High expects tighter motion matching.</small>
            </label>
            <small className="muted">Video will be trimmed to 2 minutes max and re-encoded for storage. Maximum file size: 100 MB.</small>
          </>
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
            <small className="muted">This imports your friend's shared recording into your library.</small>
          </label>
        )}

        {submitError && <p className="meta-line" style={{ color: "#ff9298" }}>{submitError}</p>}
        {progressMessage && <p className="meta-line">{progressMessage}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={handleCancel}>{busy ? "Stop" : "Cancel"}</button>
          <button className="btn btn-primary" onClick={() => handleSubmit(false)} disabled={Boolean(submitError) || busy || Boolean(videoWarning)}>
            {busy ? "Processing..." : "Import And Open Studio"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShareSettingsModal({ title, code, hasWebcam, stripWebcam, onStripChange, onGenerate, onClose }) {
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savedStripWebcam, setSavedStripWebcam] = useState(stripWebcam);
  const settingsDirty = code && stripWebcam !== savedStripWebcam;

  async function handleGenerate() {
    setGenerating(true);
    setCopied(false);
    await onGenerate();
    setSavedStripWebcam(stripWebcam);
    setGenerating(false);
  }

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
      <div className="modal share-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <h2>Share</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="meta-line">{title}</p>

        <div className="share-settings-section">
          <h3>Settings</h3>
          {hasWebcam ? (
            <label className="camera-setting-row">
              <div className="camera-setting-text">
                <span>Share pose data only</span>
                <small>Your friend receives the routine skeleton and audio, but not your webcam video recording.</small>
              </div>
              <input
                type="checkbox"
                className="camera-toggle"
                checked={stripWebcam}
                onChange={(e) => onStripChange(e.target.checked)}
              />
            </label>
          ) : (
            <p className="muted" style={{ fontSize: "0.85rem" }}>No webcam video in this recording.</p>
          )}
        </div>

        {settingsDirty && (
          <div className="share-settings-dirty">
            Settings changed. Regenerate the code for them to take effect.
          </div>
        )}

        <div className="share-settings-section">
          <h3>Share Code</h3>
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 10 }}>
            One active code per recording. Regenerating replaces the current code. Friends who already imported this session are unaffected.
          </p>
          {code ? (
            <>
              <div className="share-code-box">{code}</div>
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={copyCode}>{copied ? "Copied!" : "Copy Code"}</button>
                <button className="btn" onClick={handleGenerate} disabled={generating}>{generating ? "Regenerating..." : "Regenerate"}</button>
              </div>
            </>
          ) : (
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating..." : "Generate Code"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
