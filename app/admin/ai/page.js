import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { hasClaudeKey, vettedSites } from "@/lib/claude";
import Notice from "@/components/Notice";
import { importDriveArticles, loadFullText, runScout } from "./actions";

export const maxDuration = 300;

export default async function AiPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [sites, textCount, total] = await Promise.all([
    vettedSites(supabase, { scoutOnly: true }),
    supabase.from("articles").select("id", { count: "exact", head: true }).not("full_text", "is", null),
    supabase.from("articles").select("id", { count: "exact", head: true }),
  ]);
  const columnMissing = Boolean(textCount.error);
  const lastRun = sites.map((s) => s.lastScouted).filter(Boolean).sort().pop();

  return (
    <>
      <h1>Scout</h1>
      <p className="muted">The scout searches the vetted sources' websites for new research and puts what it finds in the review queue with drafted summaries. Nothing joins the library until you approve it.</p>
      <Notice sp={sp} />
      {!hasClaudeKey && <p className="notice error">The Anthropic API key is missing from <code>.env.local</code>.</p>}

      <section className="card">
        <h2>Run the scout</h2>
        <p>
          It will search {sites.length} websites from the <Link href="/admin/sources">Sources</Link> page
          {lastRun ? `, last checked ${new Date(lastRun).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}.
          A run takes a few minutes and costs roughly $2–3 in Anthropic usage. Later, once the site is online, it can run weekly on its own.
        </p>
        <form action={runScout}>
          <button className="button" disabled={!hasClaudeKey || !sites.length}>Run the scout</button>
        </form>
        {!sites.length && <p className="muted small">No sources have a website yet. Run <code>database/update-ai-features.sql</code> in Supabase to fill them in.</p>}
      </section>

      <section className="card">
        <h2>Import from the Drive folder</h2>
        <p>Adds the articles fetched from the shared Drive folder to the review queue, each with a drafted summary and its full text. Nothing joins the library until you approve it.</p>
        <form action={importDriveArticles}>
          <button className="button secondary" disabled={columnMissing}>Add the Drive articles to the review queue</button>
        </form>
        <p className="muted small">Safe to run again: articles already in the library are skipped.</p>
      </section>

      <section className="card">
        <h2>Full text for the research assistant</h2>
        {columnMissing ? (
          <p>First run <code>database/update-ai-features.sql</code> in Supabase (SQL Editor). It adds a place to store each article's text.</p>
        ) : (
          <p>{textCount.count} of {total.count} articles have their full text stored, so the assistant can read them.</p>
        )}
        <form action={loadFullText}>
          <button className="button secondary" disabled={columnMissing}>Load full text of the Drive files</button>
        </form>
        <p className="muted small">Copies the saved text of the 25 Drive files into the database. Safe to run again.</p>
      </section>
    </>
  );
}
