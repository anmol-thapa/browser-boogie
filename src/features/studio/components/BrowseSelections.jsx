import React from "react";
import { difficultyLabel } from "../utils";

export default function BrowseSelections({ items, loading, error, busyId, onReload, onOpenSelection }) {
  return (
    <section className="library-wrap browse-wrap">
      <div className="section-head">
        <div>
          <h2>Browse Presets</h2>
          <p className="muted">Pick preloaded videos to practice and learn!</p>
        </div>
      </div>

      {error && <p className="meta-line browse-error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="muted stats-empty-notice">No presets found. Check back soon!</p>
      )}

      <div className="library-list browse-grid">
        {items.map((item) => {
          const selectionId = String(item?.id || "");
          const isBusy = busyId === selectionId;
          const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [];
          const hasReferenceVideo = Boolean(item?.hasReferenceVideo || item?.hasWebcamVideo || item?.referenceVideoFileName);
          return (
            <article key={selectionId} className="session-card browse-card">
              <div className="browse-card-main">
                <h3>{item?.title || selectionId}</h3>
                <p className="muted">{item?.category || "General"}</p>
                {item?.description && <p className="meta-line">{item.description}</p>}
                <p className="meta-line">
                  Source: {item?.mediaFileName || "Unknown"}{" "}
                  {Number(item?.durationSec) > 0 ? `| ${(Number(item.durationSec) || 0).toFixed(1)}s` : ""}
                </p>
                <p className="meta-line">Difficulty: {difficultyLabel(item?.difficulty)}</p>
                <p className="meta-line">
                  Reference Video: {hasReferenceVideo ? "Included" : "Not included"}
                </p>
                {tags.length > 0 && (
                  <div className="browse-tags">
                    {tags.map((tag) => (
                      <span key={`${selectionId}-${tag}`} className="browse-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="session-actions">
                <button className="btn btn-primary" onClick={() => onOpenSelection(item)} disabled={isBusy}>
                  {isBusy ? "Opening..." : "Open In Studio"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
