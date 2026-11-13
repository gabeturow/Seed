import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { hasClaudeKey, vettedSites } from "@/lib/claude";
import Notice from "@/components/Notice";
import CitationFinder from "@/components/CitationFinder";
import UpdateAll from "@/components/UpdateAll";
import ScoutRunner from "@/components/ScoutRunner";
import { citedStatus } from "./cited";
import { addPdfArticles, attachPdfText, fetchMissingText, importDriveArticles, libraryStatus, redraftSummaries, removeUnusedPdfs, scoutThemeInfo, uploadArticlePdfs } from "./actions";

export const maxDuration = 300;

const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;

export default async function AiPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [sites, status, themes, cited] = await Promise.all([vettedSites(supabase, { scoutOnly: true }), libraryStatus(), scoutThemeInfo(), citedStatus()]);
  const lastRun = sites.map((s) => s.lastScouted).filter(Boolean).sort().pop();

  const todo = [
    status.newDrive > 0 && `${n(status.newDrive, "Drive article", "Drive articles")} to add to the review queue`,
    status.newPdfs > 0 && `${n(status.newPdfs, "PDF", "PDFs")} in the folder that ${status.newPdfs === 1 ? "isn't" : "aren't"} in the library yet (uses a little credit)`,
    status.noText > 0 && `${n(status.noText, "article has", "articles have")} no text yet (the update looks in the PDF folder, then tries the article link)`,
    status.noSummaries > 0 && `${n(status.noSummaries, "article needs", "articles need")} the 1-page and 5-page summaries (uses credit)`,
  ].filter(Boolean);

  return (
    <>
      <h1>Scout</h1>
      <Notice sp={sp} />
      {!hasClaudeKey && <p className="notice error">The Anthropic API key is missing from <code>.env.local</code>.</p>}

      <section className="card">
        <h2>Update the library</h2>
        <p className="muted">
          {status.total} articles in the library{status.pending ? `, ${status.pending} waiting in ` : ""}
          {status.pending ? <Link href="/admin/review">Review</Link> : ""}. One button does everything that is waiting: adds new Drive
          articles and new PDFs to the review queue, attaches text, stores the PDFs on the site, and writes summaries. It skips whatever is
          already done, so it is safe to run any time. Nothing joins the library until you approve it.
        </p>
        {status.newPdfs === null && (
          <p className="notice">After adding PDFs to the folder, run <code>python3 scripts/extract_pdf_text.py &quot;PJ_Insights Respository&quot;</code> in a terminal first so the update can see them, then run it from localhost:3000.</p>
        )}
        <UpdateAll disabled={!hasClaudeKey} todo={todo} upToDate={todo.length === 0} />
        <p className="muted small">
          Added PDFs to the folder? Run <code>python3 scripts/extract_pdf_text.py &quot;PJ_Insights Respository&quot;</code> first, and use localhost:3000
          (the saved text lives on this computer).
        </p>
      </section>

      <section className="card">
        <h2>Find new research</h2>
        <p>
          The scout searches {sites.length} vetted websites (the <Link href="/admin/sources">Sources</Link> page)
          {lastRun ? `, last checked ${new Date(lastRun).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}, one
          theme per run so it goes deep, and puts what it finds in the review queue. A run takes a few minutes and costs roughly $2–3.
        </p>
        <ScoutRunner themes={themes} defaultTheme={themes.find((t) => t.thinnest)?.key} disabled={!hasClaudeKey || !sites.length} />
      </section>

      <section className="card">
        <h2>Find papers your library cites</h2>
        <p>
          Reads the reference lists of the articles you already have and counts which works several of them cite. The most-cited ones that
          aren&apos;t in the library are looked up on the web and added to the review queue, with a note of which articles cite them.
          Reading the lists costs a few cents in all; each lookup costs a few cents.
        </p>
        <CitationFinder disabled={!hasClaudeKey} {...cited} />
      </section>

      <details className="card">
        <summary>Run one step at a time</summary>
        <p className="muted small">The update button above runs all of these. Use these only to repeat a single step.</p>
        <form action={importDriveArticles}><button className="button secondary">Add the Drive articles to the review queue</button></form>
        <form action={attachPdfText}><button className="button secondary">Attach text from the PDF folder</button></form>
        <form action={addPdfArticles}><button className="button secondary" disabled={!hasClaudeKey}>Add new PDFs to the review queue (five per click)</button></form>
        <form action={uploadArticlePdfs}><button className="button secondary">Upload the folder&apos;s PDFs to the site (six per click)</button></form>
        <form action={removeUnusedPdfs}><button className="button secondary">Remove stored PDFs no article uses</button></form>
        <form action={fetchMissingText}><button className="button secondary">Fetch missing text from article links</button></form>
        <form action={redraftSummaries}><button className="button secondary" disabled={!hasClaudeKey}>Write 1-page and 5-page summaries (four per click)</button></form>
      </details>
    </>
  );
}
