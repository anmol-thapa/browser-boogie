import React, { useState } from "react";
import { difficultyLabel, formatDateTime } from "../utils";

export default function SharedContent({ sharedByMe, sharedByMeLoading, sharedByMeError, onUnshare, onManageShare, sharedWithMe, openingSessionId, onOpenSession, onDeleteSession }) {
  const [unshareConfirm, setUnshareConfirm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function confirmUnshare() {
    if (!unshareConfirm) return;
    onUnshare(unshareConfirm.code, unshareConfirm.folderId);
    setUnshareConfirm(null);
  }

  function confirmDelete() {
    if (!deleteConfirm) return;
    onDeleteSession(deleteConfirm.id);
    setDeleteConfirm(null);
  }

  return (
    <div className="library-wrap shared-content-wrap">

      <section className="shared-section">
        <div className="section-head">
          <h2>Shared by Me</h2>
        </div>
        <p className="muted shared-notice">
          Removing a share code prevents new imports. Friends who already imported your session are not affected.
        </p>
        {sharedByMeLoading && <p className="muted">Loading...</p>}
        {sharedByMeError && <p className="meta-line" style={{ color: "#b91c1c" }}>{sharedByMeError}</p>}
        {!sharedByMeLoading && sharedByMe.length === 0 && (
          <p className="muted stats-empty-notice">You have not shared any sessions yet.</p>
        )}
        <div className="library-list">
          {sharedByMe.map((row) => (
            <article key={row.code} className={`session-card${row.deleted ? " session-card--deleted" : ""}`}>
              <div>
                <h3 style={row.deleted ? { opacity: 0.5 } : undefined}>{row.title || row.folderId}</h3>
                <p className="meta-line">Code: <strong>{row.code}</strong></p>
                {row.deleted
                  ? <p className="meta-line" style={{ color: "#92400e" }}>Removed from your library. The share code is still active. Unshare to revoke access.</p>
                  : <p className="meta-line">{row.stripWebcam ? "Pose data only (no webcam video)" : "Full recording"}</p>
                }
                <p className="meta-line">Shared {formatDateTime(row.createdAt)}</p>
              </div>
              <div className="session-actions">
                {!row.deleted && <button className="btn" onClick={() => onManageShare(row.folderId)}>Manage</button>}
                <button className="btn btn-danger" onClick={() => setUnshareConfirm(row)}>Unshare</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="shared-section">
        <div className="section-head">
          <h2>Shared with Me</h2>
        </div>
        <p className="muted shared-notice">
          Sessions imported from a friend code. These count toward your 10-recording limit since the files are stored in your account.
        </p>
        {sharedWithMe.length === 0 && (
          <p className="muted stats-empty-notice">No imported friend sessions in your library.</p>
        )}
        <div className="library-list">
          {sharedWithMe.map((session) => (
            <article key={session.id} className="session-card">
              <div>
                <h3>{session.title}</h3>
                <p className="muted">Imported via friend code</p>
                <p className="meta-line">Difficulty: {difficultyLabel(session?.config?.difficulty)}</p>
                <p className="meta-line">Created {formatDateTime(session.createdAt)}</p>
                <p className="meta-line">Last run {session.lastRunSec.toFixed(1)}s | Runs {session.runs}</p>
              </div>
              <div className="session-actions">
                <button className="btn" onClick={() => onOpenSession(session.id)} disabled={!!openingSessionId}>
                  {openingSessionId === session.id ? "Loading..." : "Open Studio"}
                </button>
                <button className="btn btn-danger" onClick={() => setDeleteConfirm(session)} disabled={!!openingSessionId}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {unshareConfirm && (
        <div className="modal-backdrop" onClick={() => setUnshareConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h2>Remove Share Code</h2>
              <button className="btn" onClick={() => setUnshareConfirm(null)}>Cancel</button>
            </div>
            <p>Remove the share code <strong>{unshareConfirm.code}</strong> for <strong>{unshareConfirm.title}</strong>?</p>
            <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
              No new imports will be possible. Friends who already imported this session keep their copy.
            </p>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={confirmUnshare}>Remove</button>
              <button className="btn" onClick={() => setUnshareConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h2>Delete Recording</h2>
            </div>
            <p>Are you sure you want to delete <strong>{deleteConfirm.title}</strong>? This cannot be undone.</p>
            <div className="studio-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
              <button className="btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
