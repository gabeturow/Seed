"use server";
import { requireAdmin } from "@/lib/auth";
import { cleanUrl } from "@/lib/forms";

// "Add an article" is a queue: this puts links and uploaded PDFs on it and returns at once. The work happens in the
// background (app/api/ingest/run). Needs database/update-ingest-jobs.sql.
const MAX_PER_BATCH = 100;

// links: free text, separated by commas, spaces or new lines. pdfs: [{ path, name }] already uploaded to storage.
export async function queueArticles({ links = "", pdfs = [], review = false } = {}) {
  const { supabase } = await requireAdmin();
  const bad = [];
  const urls = [...new Set(String(links).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
    .map((s) => { const u = cleanUrl(s); if (!u || !/^https?:\/\//i.test(u)) { bad.push(s); return null; } return u; })
    .filter(Boolean);
  const files = (Array.isArray(pdfs) ? pdfs : []).filter((f) => f && typeof f.path === "string" && /^[\w-]+\.pdf$/i.test(f.path));
  const rows = [
    ...urls.map((url) => ({ url, label: url, to_review: !!review })),
    ...files.map((f) => ({ pdf_path: f.path, label: String(f.name ?? f.path).slice(0, 200), to_review: !!review })),
  ].slice(0, MAX_PER_BATCH);
  if (!rows.length) return { error: bad.length ? `That doesn't look like a link: ${bad[0]}` : "Paste at least one link or choose some PDFs." };
  const { error } = await supabase.from("ingest_jobs").insert(rows);
  if (error) return { error: /ingest_jobs/.test(error.message) ? "The queue isn't set up yet. Run database/update-ingest-jobs.sql in Supabase first." : error.message };
  return { queued: rows.length, skipped: bad };
}

export async function retryJob(id) {
  const { supabase } = await requireAdmin();
  await supabase.from("ingest_jobs").update({ status: "queued", message: null, finished_at: null }).eq("id", id).eq("status", "failed");
  return { ok: true };
}

export async function clearFinishedJobs() {
  const { supabase } = await requireAdmin();
  await supabase.from("ingest_jobs").delete().in("status", ["done", "failed"]);
  return { ok: true };
}
