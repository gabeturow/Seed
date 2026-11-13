"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearFinishedJobs, retryJob } from "@/app/admin/ingest";
import { clearCitationRuns } from "@/app/admin/ai/cited";
import { clearBgRuns } from "@/app/admin/ai/bg";

// Admin-only panel pinned to every page: shows the articles being added in the background, and keeps the queue moving.
export default function IngestStatus() {
  const [jobs, setJobs] = useState([]);
  const [cite, setCite] = useState(null);
  const [bg, setBg] = useState([]);
  const [open, setOpen] = useState(false);
  const lastKick = useRef(0);
  const lastCiteKick = useRef(0);
  const lastBgKick = useRef(0);
  const wasBusy = useRef(false);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    let list = [], run = null, bgRuns = [];
    try {
      const res = await fetch("/api/ingest/status", { cache: "no-store" });
      if (res.ok) { const body = await res.json(); list = body.jobs ?? []; run = body.cite ?? null; bgRuns = body.bg ?? []; }
    } catch { return 20_000; }
    setJobs(list); setCite(run); setBg(bgRuns);
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
    const bgQueued = bgRuns.some((r) => r.status === "queued"), bgRunning = bgRuns.some((r) => r.status === "running");
    if (bgQueued && !bgRunning && Date.now() - lastBgKick.current > 20_000) {
      lastBgKick.current = Date.now();
      fetch("/api/bg/run", { method: "POST" }).catch(() => {});
    }
    const busy = !!(queued || running || citeQueued || citeRunning || bgQueued || bgRunning);
    if (wasBusy.current && !busy) setOpen(false);   // everything finished and the queue is empty: fold the panel away
    wasBusy.current = busy;
    return busy ? 3_000 : 20_000;
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

  if (!jobs.length && !cite && !bg.length) return null;
  const count = (s) => jobs.filter((j) => j.status === s).length;
  const active = count("queued") + count("running");
  const failed = count("failed");
  const done = count("done");
  const citeActive = cite && (cite.status === "queued" || cite.status === "running");
  const bgActive = bg.find((r) => r.status === "queued" || r.status === "running");
  const bgName = (r) => (r.kind === "scout" ? "The scout" : "Updating the library");
  const headline = bgActive && !active
    ? `${bgName(bgActive)}: ${bgActive.phase ?? "starting"}…`
    : citeActive && !active
    ? `Finding cited papers: ${cite.processed} of ${cite.how_many} looked up…`
    : active
    ? `Adding articles: ${done + failed} of ${jobs.length} finished…`
    : `${done} article${done === 1 ? "" : "s"} added${failed ? `, ${failed} failed` : ""}`;

  return (
    <aside className="ingest-panel no-print" aria-live="polite">
      <button type="button" className="ingest-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {(active > 0 || citeActive || bgActive) && <span className="ingest-dot" aria-hidden="true" />}
        <span>{headline}</span>
        <span aria-hidden="true">{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className="ingest-body">
          {bg.map((r) => (
            <p key={r.id} className={`job ${r.status}`}>
              <span className="job-state">{{ queued: "Waiting", running: "Working…", done: "Done", failed: "Failed" }[r.status]}</span>
              <span className="job-label">{bgName(r)}</span>
              <span className="job-msg">
                {r.status === "done" || r.status === "failed" ? r.message : (r.phase ?? "Starting")}
                {r.status === "done" && <> <Link href="/admin/review">See Review</Link></>}
              </span>
            </p>
          ))}
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
          {!active && !citeActive && !bgActive && <button type="button" className="link-button" onClick={async () => { await clearFinishedJobs(); await clearCitationRuns(); await clearBgRuns(); setJobs([]); setCite(null); setBg([]); }}>Clear this list</button>}
        </div>
      )}
    </aside>
  );
}
