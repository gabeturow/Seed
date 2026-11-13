import { after } from "next/server";
import { getViewer } from "@/lib/auth";
import { findCited, scanRefs } from "@/lib/cited-core";

// Runs a queued "Find papers your library cites" in the background, after the response is sent. It reads reference
// lists, then looks up the most-cited missing works. If time runs out first it puts the run back in the queue
// (progress is kept), and the status panel starts the next leg.
export const maxDuration = 300;
const STOP_STARTING_AFTER_MS = 170_000;
const STALE_MS = 8 * 60_000;

async function work(supabase, run) {
  const t0 = Date.now();
  const roomLeft = () => Date.now() - t0 < STOP_STARTING_AFTER_MS;
  const r = { scanned: run.scanned, processed: run.processed, added: run.added, not_found: run.not_found };
  const save = (extra = {}) => supabase.from("cite_runs").update({ ...r, ...extra }).eq("id", run.id);
  try {
    let scanDone = false, findDone = false;
    while (roomLeft() && !scanDone) {
      await save({ phase: "Reading reference lists" });
      const s = await scanRefs(supabase);
      if (s.fatal) throw new Error(s.text);
      r.scanned += s.scanned ?? 0;
      if (!s.left || !s.scanned) scanDone = true;
    }
    while (scanDone && roomLeft() && !findDone && r.processed < run.how_many) {
      await save({ phase: "Looking up cited works" });
      const f = await findCited(supabase, run.min_cites);
      if (f.fatal) throw new Error(f.text);
      r.processed += f.processed ?? 0; r.added += f.added ?? 0; r.not_found += f.notFound ?? 0;
      if (!f.left || !f.processed) findDone = true;
    }
    const finished = scanDone && (findDone || r.processed >= run.how_many);
    if (finished) {
      await save({
        status: "done", phase: null, finished_at: new Date().toISOString(),
        message: `Read ${r.scanned} reference list${r.scanned === 1 ? "" : "s"}. Added ${r.added} cited work${r.added === 1 ? "" : "s"} to the review queue${r.not_found ? `; couldn't find ${r.not_found} on the web` : ""}.`,
      });
    } else {
      await save({ status: "queued", phase: "Waiting to continue" });   // out of time: the panel starts the next leg
    }
  } catch (err) {
    console.error("Citation run failed:", err?.message);
    await save({ status: "failed", phase: null, finished_at: new Date().toISOString(), message: String(err?.message ?? err).slice(0, 400) });
  }
}

export async function POST() {
  const { supabase, user, profile } = await getViewer();
  if (!user || profile?.status !== "approved" || profile?.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });
  await supabase.from("cite_runs").update({ status: "queued" }).eq("status", "running").lt("started_at", new Date(Date.now() - STALE_MS).toISOString());
  const { data: next } = await supabase.from("cite_runs").select("id").eq("status", "queued").order("id").limit(1);
  if (!next?.length) return Response.json({ started: 0 });
  const { data: claimed } = await supabase.from("cite_runs").update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", next[0].id).eq("status", "queued").select("*");
  if (!claimed?.length) return Response.json({ started: 0 });
  after(() => work(supabase, claimed[0]));
  return Response.json({ started: 1 });
}
