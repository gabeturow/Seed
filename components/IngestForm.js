"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { browserClient } from "@/lib/supabase-browser";

function Go({ blocked }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button className="button" disabled={pending || blocked}>{pending ? "Reading and summarizing…" : "Add to library"}</button>
      {pending && <p className="muted" role="status">This takes one to two minutes: it reads the whole document, fills in the details, and writes three summaries. Keep this page open.</p>}
    </>
  );
}

// A link or a PDF; everything else is filled in by the server.
export default function IngestForm({ action }) {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    setPath(""); setStatus("");
    if (!file) return;
    if (file.type !== "application/pdf") { setStatus("That isn't a PDF."); return; }
    if (file.size > 50 * 1024 * 1024) { setStatus("That PDF is over 50 MB."); return; }
    setBusy(true);
    const name = `${crypto.randomUUID()}.pdf`;
    const { error } = await browserClient().storage.from("article-pdfs").upload(name, file, { contentType: "application/pdf" });
    setBusy(false);
    if (error) setStatus(`Couldn't upload it: ${error.message}`);
    else { setPath(name); setStatus(`Uploaded ${file.name}.`); }
  }

  return (
    <form action={action} className="stack">
      <label>Link to the article
        <input name="url" type="url" placeholder="https://" />
      </label>
      <p className="muted">or</p>
      <label>Upload a PDF
        <input type="file" accept="application/pdf" onChange={pick} disabled={busy} />
        <input type="hidden" name="pdf_path" value={path} />
        {status && <span className="hint" role="status">{status}</span>}
      </label>
      <p className="muted">If you give both, the PDF is kept as the article&apos;s link and the text comes from the PDF.</p>
      <div className="actions"><Go blocked={busy} /></div>
    </form>
  );
}
