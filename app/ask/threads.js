"use server";
import { revalidatePath } from "next/cache";
import { requireApproved } from "@/lib/auth";

// Saves this person's Ask conversations to their account. Needs database/update-ask-threads.sql.
const MAX_TURNS = 6;               // the question plus five follow-ups
const MAX_BYTES = 600_000;
const str = (v, max) => typeof v === "string" && v.length <= max;

function cleanTurns(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_TURNS) return null;
  const out = [];
  for (const t of raw) {
    if (!t || !str(t.question, 2000) || !str(t.answer, 40_000) || !t.question.trim() || !t.answer.trim()) return null;
    const library = (Array.isArray(t.library) ? t.library : []).slice(0, 80)
      .filter((a) => a && Number.isInteger(a.id) && str(a.title, 500) && str(a.url, 1000))
      .map((a) => ({ id: a.id, title: a.title, url: a.url, authors: str(a.authors, 800) ? a.authors : null,
        year: Number.isInteger(a.year) ? a.year : null, readFull: a.readFull === true }));
    const outside = (Array.isArray(t.outside) ? t.outside : []).slice(0, 40)
      .filter((w) => w && Number.isInteger(w.n) && w.n >= 1 && w.n <= 300 && str(w.title, 400) && str(w.url, 800))
      .map((w) => ({ n: w.n, title: w.title, url: w.url, site: str(w.site, 200) ? w.site : "", broad: w.broad === true }));
    out.push({ question: t.question.trim(), answer: t.answer.trim(), library, outside });
  }
  return JSON.stringify(out).length > MAX_BYTES ? null : out;
}

// Creates the conversation (threadId empty) or replaces its turns. Returns { id } or { error }.
export async function saveThread(threadId, rawTurns) {
  const { supabase, user } = await requireApproved();
  const turns = cleanTurns(rawTurns);
  if (!turns) return { error: "That conversation couldn't be saved." };
  const ids = [...new Set(turns.flatMap((t) => t.library.map((a) => a.id)))];
  const { data: inner } = ids.length ? await supabase.from("articles").select("id").in("id", ids).eq("internal", true) : { data: [] };
  const internal = (inner ?? []).length > 0;
  const now = new Date().toISOString();
  if (Number.isInteger(threadId)) {
    const { error } = await supabase.from("ask_threads").update({ turns, internal, updated_at: now }).eq("id", threadId).eq("user_id", user.id);
    return error ? { error: error.message } : { id: threadId };
  }
  const { data, error } = await supabase.from("ask_threads").insert({ user_id: user.id, question: turns[0].question, turns, internal }).select("id").single();
  if (error) return { error: /ask_threads/.test(error.message) ? "Saving isn't set up yet. Run database/update-ask-threads.sql in Supabase first." : error.message };
  return { id: data.id };
}

export async function deleteThread(threadId) {
  const { supabase, user } = await requireApproved();
  if (!Number.isInteger(threadId)) return { error: "Nothing to delete." };
  const { error } = await supabase.from("ask_threads").delete().eq("id", threadId).eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/ask");
  return { ok: true };
}
