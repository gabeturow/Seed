"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pipelineStep } from "@/app/admin/ai/actions";

// One button that brings the whole library up to date. Each step does only what is still waiting, so running it
// again is safe and cheap. Steps that work in batches repeat until they are done.
const STEPS = [
  { key: "import", label: "Adding the Drive articles to the review queue" },
  { key: "pdf", label: "Attaching text from the PDF folder" },
  { key: "addpdfs", label: "Adding new PDFs to the review queue", repeat: "left", costs: true },
  { key: "uploadpdfs", label: "Uploading PDFs to the site", repeat: "left" },
  { key: "cleanpdfs", label: "Removing unused stored PDFs" },
  { key: "fetch", label: "Fetching missing text from article links", repeat: "more" },
  { key: "redraft", label: "Writing short, 1-page and 5-page summaries", repeat: "left", costs: true },
];

export default function UpdateAll({ disabled, todo = [], upToDate }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState("");
  const [log, setLog] = useState([]);
  const [finished, setFinished] = useState(null);   // "done" | "stopped"
  const [withAi, setWithAi] = useState(true);

  async function call(step, state) {
    try {
      return await pipelineStep(step, state);
    } catch (err) {
      return { ok: false, fatal: true, text: `The request failed (${err?.message ?? "no connection"}). Click again to continue where it left off.` };
    }
  }

  async function runAll() {
    setRunning(true); setFinished(null); setLog([]);
    const add = (label, r) => setLog((l) => [...l, { label, ok: r.ok !== false, text: r.text }]);
    let stopped = false;
    for (const s of STEPS) {
      if (stopped) break;
      if (s.costs && !withAi) continue;
      let cursor = 0, skip = [];
      for (let i = 0; i < 40 && !stopped; i++) {
        setNow(`${s.label}${i ? ` (round ${i + 1})` : ""}…`);
        const r = await call(s.key, s.key === "fetch" ? { cursor } : { skip });
        add(s.label, r);
        if (r.fatal) { stopped = true; break; }
        skip = [...skip, ...(r.failedIds ?? []), ...(r.failedFiles ?? [])];
        if (s.key === "fetch") { if (!r.more) break; cursor = r.cursor; continue; }
        if (!s.repeat || !r.left || r.ok === false) break;
      }
    }
    setNow("");
    setFinished(stopped ? "stopped" : "done");
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="update-all">
      {todo.length > 0 ? (
        <ul>{todo.map((t, i) => <li key={i}>{t}</li>)}</ul>
      ) : upToDate ? <p className="notice ok">Everything is up to date.</p> : null}
      <label className="check inline">
        <input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} disabled={running} />
        {" "}Include the steps that use Anthropic credit (drafting new PDFs and writing summaries)
      </label>
      <p>
        <button type="button" className="button" onClick={runAll} disabled={disabled || running}>
          {running ? "Updating…" : todo.length ? "Update the library" : "Check and update the library"}
        </button>
      </p>
      {running && <p className="muted small" role="status">{now} Keep this page open.</p>}
      {log.length > 0 && (
        <ol className="update-log">
          {log.map((e, i) => (
            <li key={i} className={e.ok ? "" : "bad"}>
              <strong>{e.label}.</strong> {e.text}
            </li>
          ))}
        </ol>
      )}
      {finished === "done" && <p className="notice ok">Finished. Next: review the new and rewritten summaries in <Link href="/admin/review">Review</Link>.</p>}
      {finished === "stopped" && <p className="notice error" role="alert">Stopped early; see the last line above. Fix that, then click again. Steps already done are skipped.</p>}
    </div>
  );
}
