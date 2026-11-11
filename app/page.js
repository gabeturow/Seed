import Link from "next/link";
import { requireApproved } from "@/lib/auth";
import { loadTopicsFor } from "@/lib/articles";
import ArticleCard from "@/components/ArticleCard";
import Notice from "@/components/Notice";

export default async function LibraryPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase, isAdmin } = await requireApproved();
  const q = (sp.q ?? "").trim();
  const topic = sp.topic ? Number(sp.topic) : null;
  const source = sp.source ? Number(sp.source) : null;

  const [{ data: articles, error }, { data: topics }, { data: sources }] = await Promise.all([
    supabase.rpc("search_articles", { q: q || null, topic, source }),
    supabase.from("topics").select("id, name").order("name"),
    supabase.from("sources").select("id, name").order("name"),
  ]);

  const list = articles ?? [];
  const topicsByArticle = await loadTopicsFor(supabase, list.map((a) => a.id));
  const sourceName = Object.fromEntries((sources ?? []).map((s) => [s.id, s.name]));
  const filtering = q || topic || source;

  return (
    <>
      <section className="intro">
        <h1>The <em>library</em></h1>
        <p className="muted">Vetted research on the psychology of eating, narrative design, and behavioral design.</p>
      </section>
      <Notice sp={sp} />

      <form className="search" action="/" method="get">
        <input name="q" defaultValue={q} placeholder="Search by keyword, author, or topic" aria-label="Keyword" />
        <select name="topic" defaultValue={topic ?? ""} aria-label="Topic">
          <option value="">All topics</option>
          {(topics ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select name="source" defaultValue={source ?? ""} aria-label="Source">
          <option value="">All sources</option>
          {(sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="button" type="submit">Search</button>
        {filtering && <Link href="/" className="clear">Clear</Link>}
      </form>

      {error && <p className="notice error">Search didn't work: {error.message}</p>}
      <p className="result-count">
        {list.length === 1 ? "1 article" : `${list.length} articles`}
        {filtering ? " match" : " in the library"}
      </p>

      {list.length === 0 && filtering && (
        <div className="empty">
          <p>Nothing in the library matches that yet.</p>
          <p><Link href="/submit">Suggest an article</Link> if you know a good one.</p>
        </div>
      )}

      <div className="articles">
        {list.map((a) => (
          <ArticleCard key={a.id} article={a} topics={topicsByArticle[a.id] ?? []}
            sourceName={sourceName[a.source_id]} isAdmin={isAdmin} />
        ))}
      </div>
    </>
  );
}
