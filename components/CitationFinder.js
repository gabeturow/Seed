"use client";
import { useState, useTransition } from "react";
import { startCitationRun } from "@/app/admin/ai/cited";

// Shows the works your articles cite most that aren't in the library yet, ranked by how many of your articles cite each.
// You tick the ones to fetch; the lookup (in the background, progress in the panel at the bottom right) finds each on
// the web and puts it in the review queue with its text.
export default function CitationFinder({ disabled, ready, unscanned, missing = 0, spread = [], top = [] }) {
  const lookable = top.filter((w) => w.status === "new");
  const [picked, setPicked] = useState(() => new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickTop = (k) => setPicked(new Set(lookable.slice(0, k).map((w) => w.id)));

  function go() {
    setMsg(""); setErr("");
    start(async () => {
      const res = await startCitationRun({ ids: [...picked] });
      if (res?.error) return setErr(res.error);
      setMsg(`Started looking up ${picked.size} work${picked.size === 1 ? "" : "s"}. It runs in the background, so you can leave this page. Progress is in the panel at the bottom right, and finds go to Review.`);
      setPicked(new Set());
      window.dispatchEvent(new Event("ingest-queued"));
    });
  }

  if (!ready) return <p className="notice">First run <code>database/update-cited-works.sql</code> in the Supabase SQL Editor.</p>;
  return (
    <div className="update-all">
      <p className="muted">
        {unscanned > 0 ? `${unscanned} article${unscanned === 1 ? "" : "s"} still to read for their reference lists. ` : "All reference lists have been read. "}
        {missing} cited work{missing === 1 ? " isn't" : "s aren't"} in the library yet.
      </p>
      {spread.length > 0 && (
        <p className="muted small">
          {spread.map((s) => `${s.works} cited by ${s.n} of your articles`).join(" · ")}
        </p>
      )}

      {top.length > 0 && (
        <>
          <p>
            <strong>The {top.length} most-cited works not in the library</strong>{" "}
            <span className="muted small">
              Tick: <button type="button" className="linklike" onClick={() => pickTop(10)} disabled={pending}>top 10</button>{" · "}
              <button type="button" className="linklike" onClick={() => pickTop(25)} disabled={pending}>top 25</button>{" · "}
              <button type="button" className="linklike" onClick={() => setPicked(new Set())} disabled={pending}>none</button>
            </span>
          </p>
          <div className="cited-table">
            <table className="table">
              <thead><tr><th></th><th>Cited by</th><th>Work</th></tr></thead>
              <tbody>
                {top.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <input type="checkbox" checked={picked.has(w.id)} onChange={() => toggle(w.id)} disabled={pending || w.status !== "new"}
                        aria-label={`Look up ${w.title}`} />
                    </td>
                    <td className="cites">{w.cites}</td>
                    <td>
                      {w.title}
                      <span className="muted small"> {[w.authors, w.year].filter(Boolean).join(", ")}</span>
                      {w.status === "not_found" && <span className="flag">Looked up, not found online</span>}
                      {w.citedBy.length > 0 && (
                        <details className="small">
                          <summary className="muted">Which articles cite it</summary>
                          <ul>{w.citedBy.map((t, i) => <li key={i}>{t}</li>)}</ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p>
        <button type="button" className="button secondary" onClick={go} disabled={disabled || pending || picked.size === 0}>
          {pending ? "Starting…" : picked.size ? `Look up the ${picked.size} ticked work${picked.size === 1 ? "" : "s"}` : "Tick works to look up"}
        </button>{" "}
        <span className="muted small">Each lookup costs a few cents.</span>
      </p>
      {msg && <p className="notice ok" role="status">{msg}</p>}
      {err && <p className="notice error" role="alert">{err}</p>}
    </div>
  );
}
