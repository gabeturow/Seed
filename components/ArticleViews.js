"use client";
import { useState } from "react";
import RichText from "./RichText";

// The ways to read one article: short summary, 1 page, 5 pages, or the original (opens in a new tab).
export default function ArticleViews({ links = {}, summary, page, long, start = "short", showAiNote = false }) {
  const views = [
    { key: "short", label: "Short" },
    page && { key: "page", label: "1 page", text: page },
    long && { key: "long", label: "5 pages", text: long },
  ].filter(Boolean);
  const [view, setView] = useState(views.some((v) => v.key === start) ? start : "short");
  const current = views.find((v) => v.key === view);

  return (
    <div className="article-views">
      <div className="deeper-bar" role="tablist" aria-label="Ways to read this article">
        <span className="bar-label">Summary:</span>
        {views.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
            className={`view-tab${view === v.key ? " on" : ""}`} onClick={() => setView(v.key)}>{v.label}</button>
        ))}
        {links.page && <a className="view-tab" href={links.page} target="_blank" rel="noreferrer">{links.pageLabel}</a>}
        {links.pdf && <a className="view-tab" href={links.pdf} target="_blank" rel="noreferrer">Read the PDF</a>}
      </div>
      {view === "short" && (summary ? <p className="summary">{summary}</p> : <p className="summary placeholder">Summary to come.</p>)}
      {view !== "short" && current && (
        <div className="deeper-text">
          <RichText text={current.text} />
          {showAiNote && <p className="muted small">Written by AI from the article&apos;s full text. Check details against the original.</p>}
        </div>
      )}
    </div>
  );
}
