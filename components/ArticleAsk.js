"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import DictateButton from "./DictateButton";
import RichText from "./RichText";
import { clearArticleChat, discussArticle } from "@/app/library/[id]/actions";

// The links under a library card (Original, Go deeper, Ask a question) plus the question panel and answers.
// `children` is the rest of the card (tags and flags), which sits between the links and the panel.
export default function ArticleAsk({ articleId, url, deeperHref, saved = [], children }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(saved);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const box = useRef(null);

  function send() {
    const q = draft.trim();
    if (!q || pending) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next); setDraft(""); setError("");
    start(async () => {
      const res = await discussArticle(articleId, next);
      if (res?.reply) setMessages([...next, { role: "assistant", content: res.reply }]);
      else { setMessages(messages); setDraft(q); setError(res?.error ?? "Something went wrong. Try again."); }
    });
  }

  function clear() {
    start(async () => {
      const res = await clearArticleChat(articleId);
      if (res?.ok) { setMessages([]); setError(""); } else setError(res?.error ?? "Couldn't clear the conversation.");
    });
  }

  return (
    <>
      <p className="card-links">
        <a href={url} target="_blank" rel="noreferrer">Original</a>
        {deeperHref && <Link href={deeperHref}>Go deeper</Link>}
        <button type="button" className="link-button plain-ink" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) setTimeout(() => box.current?.focus(), 0); }}>
          Ask a question
        </button>
      </p>
      {children}
      {(messages.length > 0 || pending) && (
        <div className="thread card-thread" aria-live="polite">
          {messages.length > 0 && (
            <p className="muted small thread-head">Your conversation about this article, saved to your account.
              {" "}<button type="button" className="link-button" onClick={clear} disabled={pending}>Clear</button></p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="who">{m.role === "user" ? "You" : "Assistant"}</span>
              {m.role === "user" ? <p>{m.content}</p> : <RichText text={m.content} />}
            </div>
          ))}
          {pending && <div className="msg assistant"><span className="who">Assistant</span><p className="muted">Reading the article…</p></div>}
        </div>
      )}
      {open && (
        <form className="card-ask" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea ref={box} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000}
            aria-label="Your question about this article"
            placeholder={messages.length ? "Ask a follow-up…" : "Ask anything about this article…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <div className="discuss-actions">
            <DictateButton target={box} />
            <button className="button small" disabled={pending || !draft.trim()}>{pending ? "Reading…" : "Ask"}</button>
          </div>
        </form>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
    </>
  );
}
