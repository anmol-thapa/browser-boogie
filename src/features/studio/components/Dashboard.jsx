import React from "react";
import { ACHIEVEMENTS } from "../constants";
import { scoreToLetterGrade, computeLevel, computeAchievements } from "../utils";

function sessionTypeLabel(session) {
  if (!session) return "Deleted";
  if (session.mode === "record") return "Personal";
  if (session.mode === "create-video") return "Video Import";
  if (session.config?.source === "friend-share") return "Shared";
  if (session.config?.source === "selection") return "Browse";
  return "Session";
}

export default function Dashboard({ onRecord, onBrowse, onFriendCode, userProfile, userStats, sessions, onOpenSession, openingSessionId, statsLoading, statsError }) {
  const hasStats = Number(userStats?.runs || 0) > 0;
  const recentRuns = userStats?.recentRuns || [];
  const level = userStats?.level || computeLevel(0);
  const achievements = userStats?.achievements || computeAchievements([]);
  const xp = userStats?.xp || 0;

  const xpToNext = level.next ? level.next.xpRequired - level.current.xpRequired : null;
  const xpInLevel = level.next ? xp - level.current.xpRequired : null;
  const xpPct = xpToNext && xpInLevel != null ? Math.min(100, Math.round((xpInLevel / xpToNext) * 100)) : 100;

  return (
    <div className="dashboard-stack">
      <section className="dashboard-clean quick-start-panel">
        <h2>Quick Start</h2>
        <p className="muted">Record a video, browse a selection of videos, or try a friend's dance!</p>
        <div className="dash-actions">
          <button className="dash-big-btn dash-big-btn--record" onClick={onRecord}><span className="dash-big-btn-label">Record</span></button>
          <button className="dash-big-btn dash-big-btn--browse" onClick={onBrowse}><span className="dash-big-btn-label">Browse</span></button>
          <button className="dash-big-btn dash-big-btn--friend" onClick={onFriendCode}><span className="dash-big-btn-label">Friend Code</span></button>
        </div>
      </section>

      <section className="dashboard-clean level-panel">
        <div className="level-header">
          <div>
            <h2 className="level-name">{level.current.label}</h2>
            <p className="muted level-xp-label">
              {level.next ? `${xp} / ${level.next.xpRequired} XP` : `${xp} XP (Max level)`}
            </p>
          </div>
          {level.next && (
            <span className="level-next-label">Next: {level.next.label}</span>
          )}
        </div>
        {level.next && (
          <div className="xp-bar-track">
            <div className="xp-bar-fill" style={{ width: `${xpPct}%` }} />
          </div>
        )}

        <div className="achievements-grid">
          {ACHIEVEMENTS.map((ach) => {
            const state = achievements[ach.id] || { earned: false, progress: 0, total: 1 };
            return (
              <div key={ach.id} className={`achievement-card${state.earned ? " earned" : ""}`}>
                <div className="achievement-icon">{state.earned ? "★" : "☆"}</div>
                <div className="achievement-body">
                  <span className="achievement-label">{ach.label}</span>
                  <span className="achievement-desc">{ach.description}</span>
                  {!state.earned && state.total > 1 && (
                    <span className="achievement-progress">{state.progress} / {state.total}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="dashboard-clean stats-clean">
        <div className="section-head">
          <h2>My Stats</h2>
          <p className="muted">{userProfile?.displayName || "Dancer"}</p>
        </div>
        {statsLoading && <p className="muted">Loading stats...</p>}
        {!statsLoading && statsError && <p className="muted">{statsError}</p>}
        {!statsLoading && !statsError && !hasStats && (
          <p className="muted stats-empty-notice">Your stats from completed playbacks will show here.</p>
        )}
        {!statsLoading && !statsError && hasStats && (
          <>
            <div className="stats-grid">
              <article className="stats-item">
                <p className="muted">Runs</p>
                <h3>{userStats.runs}</h3>
              </article>
              <article className="stats-item">
                <p className="muted">Average</p>
                <h3>{Number(userStats.averageScore || 0).toFixed(1)}%</h3>
              </article>
              <article className="stats-item">
                <p className="muted">Grade</p>
                <h3>{userStats.grade || scoreToLetterGrade(userStats.averageScore)}</h3>
              </article>
            </div>

            {recentRuns.length > 0 && (
              <div className="recent-runs-block">
                <h3>Recent Runs</h3>
                <div className="recent-runs-list">
                  {recentRuns.map((run) => {
                    const session = sessions?.find((s) => s.id === run.sessionId);
                    const deleted = !session;
                    const typeLabel = sessionTypeLabel(session);
                    const isLoading = openingSessionId === run.sessionId;
                    return (
                      <div key={run.id} className="recent-run-row">
                        <div className="recent-run-info">
                          <span className="recent-run-title">{run.sessionTitle || "Practice"}</span>
                          <span className="recent-run-type">{typeLabel}</span>
                        </div>
                        <div className="recent-run-meta">
                          <span className="recent-run-score">{Number(run.averageScore || 0).toFixed(1)}%</span>
                          <span className="recent-run-grade">{run.grade}</span>
                          <span className="muted recent-run-date">{run.endedAt ? new Date(run.endedAt).toLocaleDateString() : ""}</span>
                          <button
                            className="btn recent-run-open"
                            onClick={() => !deleted && onOpenSession(run.sessionId)}
                            disabled={deleted || !!openingSessionId}
                            title={deleted ? "Recording deleted" : isLoading ? "Loading..." : "Open in Studio"}
                          >
                            {isLoading ? "Loading..." : deleted ? "Deleted" : "Open"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
