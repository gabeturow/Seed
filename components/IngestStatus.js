"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearFinishedJobs, retryJob } from "@/app/admin/ingest";
import { clearCitationRuns } from "@/app/admin/ai/cited";

// Admin-only panel pinned to every page: shows the articles being added in the background, and keeps the queue moving.
export default function IngestStatus() {
  const [jobs, setJobs] = useState([]);
  const [cite, setCite] = useState(null);
  const [open, setOpen] = useState(false);
  const lastKick = useRef(0);
  const lastCiteKick = useRef(0);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    let list = [], run = null;
    try {
      const res = await fetch("/api/ingest/status", { cache: "no-store" });
      if (res.ok) { const body = await res.json(); list = body.jobs ?? []; run = body.cite ?? null; }
    } catch { return 20_000; }
    setJobs(list); setCite(run);
    const queued = list.filter((j) => j.status === "queued").length;
    const running = list.filter((j) => j.status === "running").length;
    if (queued && (running === 0 || Date.now() - lastKick.current > 30_000)) {
      lastKick.current = Date.now();
      fetch("/api/ingest/run", { method: "POST" }).catch(() => {});
    }
    const citeQueued = run?.status === "queued", citeRunning = run?.status === "running";
    if (citeQueued && (!citeRunning && Date.now() - lastCiteKick.current > 20_000)) {
      lastCiteKick.current = Date.now();
      fetch("/api/cited/run", { method: "POST" }).catch(() => {});
    }
    return queued || running || citeQueued || citeRunning ? 3_000 : 20_000;
  }, []);

  useEffect(() => {
    let stop = false;
    const loop = async () => {
      const next = await refresh();
      if (!stop) timer.current = setTimeout(loop, next);
    };
    const kick = () => { clearTimeout(timer.current); loop(); setOpen(true); };
    loop();
    window.addEventListener("ingest-queued", kick);
    return () => { stop = true; clearTimeout(timer.current); window.removeEventListener("ingest-queued", kick); };
  }, [refresh]);

  if (!jobs.length && !cite) return null;
  const count = (s) => jobs.filter((j) => j.status === s).length;
  const active = count("queued") + count("running");
  const failed = count("failed");
  const done = count("done");
  const citeActive = cite && (cite.status === "queued" || cite.status === "running");
  const headline = citeActive && !active
    ? `Finding cited papers: ${cite.processed} of ${cite.how_many} looked up…`
    : active
    ? `Adding articles: ${done + failed} of ${jobs.length} finished…`
    : `${done} article${done === 1 ? "" : "s"} added${failed ? `, ${failed} failed` : ""}`;

  return (
    <aside className="ingest-panel no-print" aria-live="polite">
      <button type="button" className="ingest-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {(active > 0 || citeActive) && <span className="ingest-dot" aria-hidden="true" />}
        <span>{headline}</span>
        <span aria-hidden="true">{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className="ingest-body">
          {cite && (
            <p className={`job ${cite.status}`}>
              <span className="job-state">{{ queued: "Waiting", running: "Working…", done: "Done", failed: "Failed" }[cite.status]}</span>
              <span className="job-label">Finding papers your library cites</span>
              <span className="job-msg">
                {cite.status === "done" || cite.status === "failed" ? cite.message
                  : `${cite.phase ?? "Starting"}. ${cite.scanned} reference lists read, ${cite.processed} of ${cite.how_many} works looked up, ${cite.added} added.`}
                {cite.status === "done" && cite.added > 0 && <> <Link href="/admin/review">See them in Review</Link></>}
              </span>
            </p>
          )}
          <ul>
            {jobs.map((j) => (
              <li key={j.id} className={`job ${j.status}`}>
                <span className="job-state">{{ queued: "Waiting", running: "Working…", done: "Added", failed: "Failed" }[j.status]}</span>
                {j.article_id && j.status === "done"
                  ? <Link href={`/admin/articles/${j.article_id}`}>{j.label || `Article ${j.article_id}`}</Link>
                  : <span className="job-label">{j.label || j.url}</span>}
                {j.message && <span className="job-msg">{j.message}</span>}
                {j.status === "failed" && <button type="button" className="link-button" onClick={async () => { await retryJob(j.id); refresh(); }}>Retry</button>}
              </li>
            ))}
          </ul>
          {!active && !citeActive && <button type="button" className="link-button" onClick={async () => { await clearFinishedJobs(); await clearCitationRuns(); setJobs([]); setCite(null); }}>Clear this list</button>}
        </div>
      )}
    </aside>
  );
}
