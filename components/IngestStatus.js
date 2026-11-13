"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearFinishedJobs, retryJob } from "@/app/admin/ingest";

// Admin-only panel pinned to every page: shows the articles being added in the background, and keeps the queue moving.
export default function IngestStatus() {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const lastKick = useRef(0);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    let list = [];
    try {
      const res = await fetch("/api/ingest/status", { cache: "no-store" });
      if (res.ok) list = (await res.json()).jobs ?? [];
    } catch { return 20_000; }
    setJobs(list);
    const queued = list.filter((j) => j.status === "queued").length;
    const running = list.filter((j) => j.status === "running").length;
    if (queued && (running === 0 || Date.now() - lastKick.current > 30_000)) {
      lastKick.current = Date.now();
      fetch("/api/ingest/run", { method: "POST" }).catch(() => {});
    }
    return queued || running ? 3_000 : 20_000;
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

  if (!jobs.length) return null;
  const count = (s) => jobs.filter((j) => j.status === s).length;
  const active = count("queued") + count("running");
  const failed = count("failed");
  const done = count("done");
  const headline = active
    ? `Adding articles: ${done + failed} of ${jobs.length} finished…`
    : `${done} article${done === 1 ? "" : "s"} added${failed ? `, ${failed} failed` : ""}`;

  return (
    <aside className="ingest-panel no-print" aria-live="polite">
      <button type="button" className="ingest-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {active > 0 && <span className="ingest-dot" aria-hidden="true" />}
        <span>{headline}</span>
        <span aria-hidden="true">{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className="ingest-body">
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
          {!active && <button type="button" className="link-button" onClick={async () => { await clearFinishedJobs(); setJobs([]); }}>Clear this list</button>}
        </div>
      )}
    </aside>
  );
}
