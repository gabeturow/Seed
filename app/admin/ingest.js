"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setTopics } from "@/lib/articles";
import { fetchArticleText, pdfBufferText } from "@/lib/fulltext";
import { hasClaudeKey } from "@/lib/claude";
import { describeDocument, writeThree } from "@/lib/summaries";
import { cleanUrl, text, withMsg } from "@/lib/forms";

// "Add an article": give a link or a PDF and everything else is filled in. Reads the text, drafts the title,
// authors, date, citation, source and topics, and writes the short, one-page and five-page summaries.
// The article goes into the library right away, flagged "summary needs review"; the edit page opens so it can be checked.
const BACK = "/admin/articles/new";
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const urlKey = (u) => String(u ?? "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").replace(/\/+$/, "");

export async function addArticleFromSource(fd) {
  const { supabase, user } = await requireAdmin();
  const fail = (m) => redirect(withMsg(BACK, m, "error"));
  if (!hasClaudeKey) fail("The Anthropic API key is missing from .env.local.");

  const link = cleanUrl(text(fd, "url"));
  const pdfPath = text(fd, "pdf_path");
  if (!link && !pdfPath) fail("Paste a link or choose a PDF.");

  // 1. Duplicate check by link.
  if (link && !pdfPath) {
    const { data: all } = await supabase.from("articles").select("id, url");
    const hit = (all ?? []).find((a) => urlKey(a.url) === urlKey(link));
    if (hit) redirect(withMsg(`/admin/articles/${hit.id}`, "That link is already in the library. Here it is."));
  }

  // 2. Get the text.
  let body = null;
  if (pdfPath) {
    const { data: blob, error } = await supabase.storage.from("article-pdfs").download(pdfPath);
    if (error) fail(`Couldn't read the uploaded PDF: ${error.message}`);
    body = await pdfBufferText(Buffer.from(await blob.arrayBuffer()));
    if (!body) fail("That PDF has no readable text (it may be a scan). Try another copy, or add it by hand below.");
  } else {
    body = await fetchArticleText(link);
    if (!body) fail("Couldn't read that page (it may be behind a paywall or a sign-in). Download it as a PDF and upload that instead, or add it by hand below.");
  }

  // 3. Duplicate check by text.
  const { data: dup } = await supabase.from("articles").select("id").eq("full_text", body).limit(1).maybeSingle();
  if (dup) redirect(withMsg(`/admin/articles/${dup.id}`, "That article is already in the library. Here it is."));

  // 4. Details and summaries.
  const [{ data: topics }, { data: sources }] = await Promise.all([
    supabase.from("topics").select("id, name"),
    supabase.from("sources").select("id, name"),
  ]);
  const topicId = Object.fromEntries((topics ?? []).map((t) => [t.name.toLowerCase(), t.id]));
  let info, three;
  try {
    info = await describeDocument({ text: body, hint: link ?? "", topicList: (topics ?? []).map((t) => t.name).join("; ") });
    three = await writeThree(info.title, body);
  } catch (err) {
    console.error("Ingest failed", err?.message);
    fail("Couldn't read that document well enough to summarize it. Try again, or add it by hand below.");
  }

  const title = String(info.title ?? "").trim() || null;
  if (title) {
    const { data: same } = await supabase.from("articles").select("id, title");
    const hit = (same ?? []).find((a) => norm(a.title) === norm(title));
    if (hit) redirect(withMsg(`/admin/articles/${hit.id}`, "An article with that title is already in the library. Here it is."));
  }
  const pub = String(info.publisher ?? "").toLowerCase();
  const source = pub ? (sources ?? []).find((s) => pub.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(pub)) : null;
  const year = Number.isInteger(info.year) ? info.year : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(info.date ?? "") ? info.date : null;
  const notes = [pdfPath && link ? `Original web link: ${link}` : "", "Details and summaries were drafted by AI from the text when this was added; check them.",
    info.publisher ? `Publisher or journal: ${info.publisher}.` : "", info.uncertain || ""].filter(Boolean).join(" ");

  const { data: row, error } = await supabase.from("articles").insert({
    url: pdfPath ? "pending" : link, title, authors: info.authors || null,
    publication_year: year ?? (date ? Number(date.slice(0, 4)) : null), publication_date: date,
    resource_type: info.resource_type || null, source_id: source?.id ?? null,
    related_organizations: info.other_organizations || null, publication_details: info.citation || null,
    summary: three.short, summary_page: three.page, summary_long: three.long,
    summary_origin: "ai_draft", summary_needs_review: true, admin_notes: notes, full_text: body,
    pdf_path: pdfPath ?? null, status: "approved", origin: "admin",
    submitted_by: user.id, reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).select("id").single();
  if (error) fail(error.message);
  if (pdfPath) await supabase.from("articles").update({ url: `/library/${row.id}/pdf` }).eq("id", row.id);

  const tids = (Array.isArray(info.topics) ? info.topics : []).map((t) => topicId[String(t).toLowerCase()]).filter(Boolean).slice(0, 4);
  try { await setTopics(supabase, row.id, tids); } catch { /* topics are optional */ }

  revalidatePath("/", "layout");
  redirect(withMsg(`/admin/articles/${row.id}`, `Added “${title ?? "the article"}” to the library with its details and three summaries filled in. Take a look and fix anything that's off.`));
}
