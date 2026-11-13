"use client";
import { useRef, useState, useTransition } from "react";
import { browserClient } from "@/lib/supabase-browser";
import { queueArticles } from "@/app/admin/ingest";

const MAX_BYTES = 50 * 1024 * 1024;

// Adds articles in bulk: pasted links (commas or new lines), PDFs, or a whole folder of PDFs.
// Everything is put on a queue and processed in the background, so the person is free to move on at once.
export default function IngestForm() {
  const [links, setLinks] = useState("");
  const [review, setReview] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState("");
  const [pending, start] = useTransition();
  const filesRef = useRef(null);
  const folderRef = useRef(null);

  const note = (n, skipped = []) =>
    `Queued ${n} article${n === 1 ? "" : "s"}. They're being added in the background, so you can leave this page. Progress is in the panel at the bottom right.${skipped.length ? ` Skipped (not links): ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}.` : ""}`;

  async function upload(files) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    const skipped = files.length - pdfs.length;
    const big = pdfs.filter((f) => f.size > MAX_BYTES);
    const ok = pdfs.filter((f) => f.size <= MAX_BYTES);
    const problems = [];
    if (skipped) problems.push(`${skipped} file${skipped === 1 ? " isn't a PDF" : "s aren't PDFs"}`);
    if (big.length) problems.push(`${big.length} over 50 MB`);
    if (!ok.length) { setErr(`No PDFs to add${problems.length ? ` (${problems.join(", ")})` : ""}.`); return; }
    const client = browserClient();
    let next = 0, done = 0, queued = 0, failed = 0;
    setProgress(`Uploading 0 of ${ok.length}…`);
    await Promise.all(Array.from({ length: Math.min(3, ok.length) }, async () => {
      while (next < ok.length) {
        const f = ok[next++];
        const name = `${crypto.randomUUID()}.pdf`;
        const { error } = await client.storage.from("article-pdfs").upload(name, f, { contentType: "application/pdf" });
        if (error) failed++;
        else {
          const res = await queueArticles({ pdfs: [{ path: name, name: f.name }], review });   // queued as soon as it's uploaded
          if (res?.queued) { queued += res.queued; window.dispatchEvent(new Event("ingest-queued")); } else failed++;
        }
        done++;
        setProgress(`Uploading ${done} of ${ok.length}…`);
      }
    }));
    setProgress("");
    if (failed) problems.push(`${failed} couldn't be uploaded`);
    if (queued) setMsg(`${note(queued)}${problems.length ? ` Not added: ${problems.join(", ")}.` : ""}`);
    else setErr(`Nothing was added: ${problems.join(", ")}.`);
  }

  function onFiles(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    setMsg(""); setErr("");
    if (files.length) upload(files);
  }

  function submitLinks(e) {
    e.preventDefault();
    setMsg(""); setErr("");
    if (!links.trim()) return setErr("Paste at least one link, or choose PDFs below.");
    start(async () => {
      const res = await queueArticles({ links, review });
      if (res?.error) return setErr(res.error);
      setLinks("");
      setMsg(note(res.queued, res.skipped));
      window.dispatchEvent(new Event("ingest-queued"));
    });
  }

  return (
    <div className="stack">
      <label className="check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Send to the review queue instead of publishing right away</label>
      <form onSubmit={submitLinks} className="stack">
        <label>Links
          <textarea rows={5} value={links} onChange={(e) => setLinks(e.target.value)}
            placeholder={"https://example.org/report\nhttps://example.org/paper.pdf\nOne per line, or separated by commas"} />
        </label>
        <div className="actions"><button className="button" disabled={pending}>{pending ? "Queuing…" : "Add these links"}</button></div>
      </form>

      <p className="muted">or</p>

      <div className="stack">
        <span className="label-text">PDFs</span>
        <div className="actions">
          <button type="button" className="button secondary" onClick={() => filesRef.current?.click()} disabled={!!progress}>Choose PDFs…</button>
          <button type="button" className="button secondary" onClick={() => folderRef.current?.click()} disabled={!!progress}>Choose a folder…</button>
        </div>
        <input ref={filesRef} type="file" accept="application/pdf" multiple hidden onChange={onFiles} />
        <input ref={folderRef} type="file" webkitdirectory="" multiple hidden onChange={onFiles} />
        <span className="hint">A folder adds every PDF inside it (up to 100 at a time, 50 MB each). Keep this page open while files upload; reading and summarizing happens afterward, in the background.</span>
        {progress && <p className="muted" role="status">{progress}</p>}
      </div>

      {msg && <p className="notice" role="status">{msg}</p>}
      {err && <p className="notice error" role="alert">{err}</p>}
    </div>
  );
}
