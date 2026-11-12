import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApproved } from "@/lib/auth";
import { hasClaudeKey } from "@/lib/claude";
import { displayDate, loadTopicsFor } from "@/lib/articles";
import ArticleViews from "@/components/ArticleViews";
import { loadChats } from "@/lib/chats";
import DiscussArticle from "@/components/DiscussArticle";

export const maxDuration = 120;

export default async function ArticlePage({ params, searchParams }) {
  const { id: raw } = await params;
  const { view } = await searchParams;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const { supabase, user, isAdmin, isStaff } = await requireApproved();
  const { data: a } = await supabase.from("articles")
    .select("id, url, title, authors, publication_year, publication_date, resource_type, summary, summary_origin, internal, source_id, summary_page, summary_long")
    .eq("id", id).eq("status", "approved").maybeSingle();
  if (!a) notFound();
  const [topics, { data: source }, textRow] = await Promise.all([
    loadTopicsFor(supabase, [a.id]),
    a.source_id ? supabase.from("sources").select("name").eq("id", a.source_id).maybeSingle() : { data: null },
    supabase.from("articles").select("id").eq("id", a.id).not("full_text", "is", null).maybeSingle(),   // is there stored text? (not loaded here)
  ]);
  const meta = [a.authors, source?.name, displayDate(a), a.resource_type].filter(Boolean);
  const hasText = Boolean(textRow?.data);
  const saved = (await loadChats(supabase, user.id, [a.id]))[a.id] ?? [];

  return (
    <>
      <p className="back"><Link href="/library">← Library</Link></p>
      <article className="card article">
        <h1 className="article-title">{a.title || a.url}</h1>
        {meta.length > 0 && <p className="meta">{meta.join(" · ")}</p>}
        <ArticleViews url={a.url} summary={a.summary} page={a.summary_page} long={a.summary_long} start={view} showAiNote={isStaff} />
        <div className="card-foot">
          <div className="tags">
            {(topics[a.id] ?? []).map((t) => <Link key={t.id} href={`/library?topic=${t.id}`} className="tag">{t.name}</Link>)}
          </div>
          <div className="flags">
            {a.internal && <span className="flag warn">Internal</span>}
            {isStaff && a.summary_origin === "ai_draft" && <span className="flag">AI-drafted summary</span>}
            {isAdmin && <Link className="edit" href={`/admin/articles/${a.id}`}>Edit</Link>}
          </div>
        </div>
      </article>

      <section className="discuss">
        <h2>Discuss this article</h2>
        <p className="muted small">
          {hasText
            ? "The assistant has read the full text. Ask what it found, how it was done, what its limits are, or how to use it."
            : "The full text of this article isn't stored, so the assistant can only work from the summary and can't check details."}
          {" "}Your conversation is saved to your account, so it&apos;s here next time.
        </p>
        {hasClaudeKey
          ? <DiscussArticle articleId={a.id} hasText={hasText} saved={saved} />
          : <div className="card"><p>The research assistant isn&apos;t set up yet: the Anthropic API key is missing from <code>.env.local</code>.</p></div>}
      </section>
    </>
  );
}
