import React, { useState } from "react";
import { difficultyLabel, modeLabel, describeSessionConfig, formatDateTime, isShareableSession } from "../utils";

export default function Library({ sessions, sharedFolderIds, folderIdBySession, openingSessionId, onOpenSession, onDeleteSession, onShareSession, onRecord, onImport }) {
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function requestDelete(session) {
    const folderId = folderIdBySession?.[session.id] || session.dataFolderId;
    const isShared = folderId && sharedFolderIds?.has(folderId);
    setDeleteConfirm({ session, isShared });
  }

  function confirmDelete() {
    if (!deleteConfirm) return;
    onDeleteSession(deleteConfirm.session.id);
    setDeleteConfirm(null);
  }

  return (
    <section className="library-wrap">
      <div className="section-head">
        <h2>My Library</h2>
        <div className="top-actions">
          <button className="btn btn-primary" onClick={onRecord}>Record</button>
          <button className="btn" onClick={onImport}>Import</button>
        </div>
      </div>

      {sessions.length === 0 && <p className="muted stats-empty-notice">No sessions saved yet. Start Recording!</p>}

      <div className="library-list">
        {sessions.map((session) => (
          <article key={session.id} className="session-card">
            <div>
              <h3>{session.title}</h3>
              <p className="muted">{modeLabel(session.mode)}</p>
              <p className="meta-line">{describeSessionConfig(session)}</p>
              <p className="meta-line">Difficulty: {difficultyLabel(session?.config?.difficulty)}</p>
              <p className="meta-line">Created {formatDateTime(session.createdAt)}</p>
              <p className="meta-line">Last run {session.lastRunSec.toFixed(1)}s | Runs {session.runs}</p>
              {session.status === "missing-data" && (
                <p className="meta-line" style={{ color: "#b91c1c" }}>
                  Session files missing from disk. Re-import required.
                </p>
              )}
            </div>
            <div className="session-actions">
              <button className="btn" onClick={() => onOpenSession(session.id)} disabled={!!openingSessionId}>
                {openingSessionId === session.id ? "Loading..." : "Open Studio"}
              </button>
              {isShareableSession(session) && (
                <button className="btn" onClick={() => onShareSession(session.id)} disabled={!!openingSessionId}>Share</button>
              )}
              <button className="btn btn-danger" onClick={() => requestDelete(session)} disabled={!!openingSessionId}>Delete</button>
            </div>
          </article>
        ))}
      </div>

      {deleteConfirm && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h2>Delete Recording</h2>
            </div>
            <p>Are you sure you want to delete <strong>{deleteConfirm.session.title}</strong>? This cannot be undone.</p>
            {deleteConfirm.isShared && (
              <p className="meta-line" style={{ marginTop: 10, color: "#92400e" }}>
                This recording is currently shared. Deleting it will revoke the share code and no one will be able to import it. Friends who already imported it are not affected.
              </p>
            )}
            <div className="studio-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
              <button className="btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
