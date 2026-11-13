import { revalidatePath } from "next/cache";
import { setTopics } from "@/lib/articles";
import { fetchArticleText, pdfBufferText } from "@/lib/fulltext";
import { describeDocument, writeThree } from "@/lib/summaries";

// Turns one queued job (a link or an uploaded PDF) into a library article: reads the text, drafts the details
// and writes the three summaries. Returns { id, title, duplicate }. Throws an Error with a plain message on failure.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const urlKey = (u) => String(u ?? "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").replace(/\/+$/, "");

export async function ingestOne(supabase, user, { url, pdf_path: pdfPath }) {
  // 1. Already in the library by link?
  if (url && !pdfPath) {
    const { data: all } = await supabase.from("articles").select("id, title, url");
    const hit = (all ?? []).find((a) => urlKey(a.url) === urlKey(url));
    if (hit) return { id: hit.id, title: hit.title, duplicate: true };
  }

  // 2. The text.
  let body;
  if (pdfPath) {
    const { data: blob, error } = await supabase.storage.from("article-pdfs").download(pdfPath);
    if (error) throw new Error(`Couldn't read the uploaded PDF: ${error.message}`);
    body = await pdfBufferText(Buffer.from(await blob.arrayBuffer()));
    if (!body) throw new Error("That PDF has no readable text (it may be a scan).");
  } else {
    body = await fetchArticleText(url);
    if (!body) throw new Error("Couldn't read that page (paywall or sign-in?). Download it as a PDF and upload that instead.");
  }

  // 3. Already in the library by text?
  const { data: dup } = await supabase.from("articles").select("id, title").eq("full_text", body).limit(1).maybeSingle();
  if (dup) return { id: dup.id, title: dup.title, duplicate: true };

  // 4. Details and the three summaries, at the same time.
  const [{ data: topics }, { data: sources }] = await Promise.all([
    supabase.from("topics").select("id, name"),
    supabase.from("sources").select("id, name"),
  ]);
  const topicId = Object.fromEntries((topics ?? []).map((t) => [t.name.toLowerCase(), t.id]));
  let info, three;
  try {
    [info, three] = await Promise.all([
      describeDocument({ text: body, hint: url ?? "", topicList: (topics ?? []).map((t) => t.name).join("; ") }),
      writeThree(null, body),
    ]);
  } catch (err) {
    console.error("Ingest failed", err?.message);
    throw new Error("Couldn't read that document well enough to summarize it.");
  }

  const title = String(info.title ?? "").trim() || null;
  if (title) {
    const { data: same } = await supabase.from("articles").select("id, title");
    const hit = (same ?? []).find((a) => norm(a.title) === norm(title));
    if (hit) return { id: hit.id, title: hit.title, duplicate: true };
  }
  const pub = String(info.publisher ?? "").toLowerCase();
  const source = pub ? (sources ?? []).find((s) => pub.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(pub)) : null;
  const year = Number.isInteger(info.year) ? info.year : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(info.date ?? "") ? info.date : null;
  const notes = [pdfPath && url ? `Original web link: ${url}` : "", "Details and summaries were drafted by AI from the text when this was added; check them.",
    info.publisher ? `Publisher or journal: ${info.publisher}.` : "", info.uncertain || ""].filter(Boolean).join(" ");

  const { data: row, error } = await supabase.from("articles").insert({
    url: pdfPath ? "pending" : url, title, authors: info.authors || null,
    publication_year: year ?? (date ? Number(date.slice(0, 4)) : null), publication_date: date,
    resource_type: info.resource_type || null, source_id: source?.id ?? null,
    related_organizations: info.other_organizations || null, publication_details: info.citation || null,
    summary: three.short, summary_page: three.page, summary_long: three.long,
    summary_origin: "ai_draft", summary_needs_review: true, admin_notes: notes, full_text: body,
    pdf_path: pdfPath ?? null, status: "approved", origin: "admin",
    submitted_by: user.id, reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (pdfPath) await supabase.from("articles").update({ url: `/library/${row.id}/pdf` }).eq("id", row.id);

  const tids = (Array.isArray(info.topics) ? info.topics : []).map((t) => topicId[String(t).toLowerCase()]).filter(Boolean).slice(0, 4);
  try { await setTopics(supabase, row.id, tids); } catch { /* topics are optional */ }
  try { revalidatePath("/", "layout"); } catch { /* not critical */ }
  return { id: row.id, title, duplicate: false };
}
