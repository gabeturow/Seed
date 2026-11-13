import { after } from "next/server";
import { getViewer } from "@/lib/auth";
import { PIPELINE, pipelineCore, scoutLeg } from "@/lib/ai-core";

// Runs a queued scout or "Update the library" in the background, after the response is sent, so it carries on if the
// person leaves the page. If time runs out first the run goes back in the queue with its progress kept, and the
// status panel starts the next leg.
export const maxDuration = 300;
const STOP_STARTING_AFTER_MS = 120_000;
const STALE_MS = 8 * 60_000;

async function scoutWork(supabase, run, t0) {
  const p = { next: 0, added: 0, skipped: 0, withText: 0, failures: [], ...run.progress };
  const save = (extra = {}) => supabase.from("bg_runs").update({ progress: p, ...extra }).eq("id", run.id);
  await save({ phase: "Searching the vetted websites" });
  const r = await scoutLeg(supabase, { chosen: run.params?.theme, from: p.next, until: t0 + STOP_STARTING_AFTER_MS });
  p.added += r.added; p.skipped += r.skipped; p.withText += r.withText; p.failures.push(...r.failures); p.next = r.next; p.total = r.total;
  if (r.next < r.total) return save({ status: "queued", phase: `Searched ${r.next} of ${r.total} website groups` });
  const msg = [
    p.added ? `The scout added ${p.added} article${p.added === 1 ? "" : "s"} to the review queue.` : "The scout didn't find anything new this time.",
    p.skipped ? `It skipped ${p.skipped} already in the library.` : "",
    p.added ? `Saved the full text for ${p.withText} of them.` : "",
    p.failures.length ? `Some websites couldn't be searched (${p.failures.length} group${p.failures.length === 1 ? "" : "s"}). Anthropic said: ${p.failures[0]}` : "",
  ].filter(Boolean).join(" ");
  return save({ status: "done", phase: null, message: msg, finished_at: new Date().toISOString() });
}

async function updateWork(supabase, run, t0) {
  const p = { idx: 0, round: 0, cursor: 0, skip: [], log: [], ...run.progress };
  const save = (extra = {}) => supabase.from("bg_runs").update({ progress: p, ...extra }).eq("id", run.id);
  const withAi = run.params?.withAi !== false;
  while (p.idx < PIPELINE.length && Date.now() - t0 < STOP_STARTING_AFTER_MS) {
    const s = PIPELINE[p.idx];
    const next = () => { p.idx++; p.round = 0; p.cursor = 0; p.skip = []; };
    if (s.costs && !withAi) { next(); continue; }
    await save({ phase: `${s.label}${p.round ? ` (round ${p.round + 1})` : ""}` });
    const r = await pipelineCore(supabase, s.key, s.key === "fetch" ? { cursor: p.cursor } : { skip: p.skip });
    p.log = [...p.log, { label: s.label, ok: r.ok !== false, text: String(r.text ?? "").slice(0, 300) }].slice(-40);
    p.round++;
    if (r.fatal && !s.local) {   // a real problem: stop here (steps that only work on the computer holding the local files are just skipped)
      return save({ status: "failed", phase: null, message: `${s.label}: ${r.text}`.slice(0, 400), finished_at: new Date().toISOString() });
    }
    if (r.fatal) { next(); continue; }
    p.skip = [...p.skip, ...(r.failedIds ?? []), ...(r.failedFiles ?? [])];
    if (s.key === "fetch") { if (!r.more) next(); else p.cursor = r.cursor; }
    else if (!s.repeat || !r.left || r.ok === false) next();
    if (p.round >= 40) next();
  }
  if (p.idx < PIPELINE.length) return save({ status: "queued", phase: "Waiting to continue" });
  const useful = p.log.filter((e) => e.ok && e.text && !/^(No |Nothing|Every|All )/i.test(e.text));
  return save({ status: "done", phase: null, finished_at: new Date().toISOString(),
    message: useful.length ? `Finished. ${useful.slice(-3).map((e) => e.text).join(" ")} Review the new and rewritten summaries in Review.` : "Everything was already up to date." });
}

async function work(supabase, run) {
  const t0 = Date.now();
  try {
    await (run.kind === "scout" ? scoutWork(supabase, run, t0) : updateWork(supabase, run, t0));
  } catch (err) {
    console.error("Background run failed:", err?.message);
    await supabase.from("bg_runs").update({ status: "failed", phase: null, finished_at: new Date().toISOString(), message: String(err?.message ?? err).slice(0, 400) }).eq("id", run.id);
  }
}

export async function POST() {
  const { supabase, user, profile } = await getViewer();
  if (!user || profile?.status !== "approved" || profile?.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });
  await supabase.from("bg_runs").update({ status: "queued" }).eq("status", "running").lt("started_at", new Date(Date.now() - STALE_MS).toISOString());
  const { data: next } = await supabase.from("bg_runs").select("id").eq("status", "queued").order("id").limit(1);
  if (!next?.length) return Response.json({ started: 0 });
  const { data: claimed } = await supabase.from("bg_runs").update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", next[0].id).eq("status", "queued").select("*");
  if (!claimed?.length) return Response.json({ started: 0 });
  after(() => work(supabase, claimed[0]));
  return Response.json({ started: 1 });
}
