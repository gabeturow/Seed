import { requireAdmin } from "@/lib/auth";
import ArticleForm from "@/components/ArticleForm";
import Notice from "@/components/Notice";
import IngestForm from "@/components/IngestForm";
import { saveArticle } from "../../actions";

export const maxDuration = 300;

export default async function NewArticlePage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: sources }, { data: topics }] = await Promise.all([
    supabase.from("sources").select("id, name").order("name"),
    supabase.from("topics").select("id, name").order("name"),
  ]);
  return (
    <section className="card">
      <h1>Add an article</h1>
      <p className="muted">Paste links (one per line or separated by commas), or upload PDFs or a whole folder of them. Each one is added in the background, so you don't have to wait. The title, authors, date, citation, source, topics and the short, one-page and five-page summaries are filled in for you, and the article goes straight into the library. You can fix anything afterward in the panel's links.</p>
      <Notice sp={sp} />
      <IngestForm />
      <details style={{ marginTop: "2rem" }}>
        <summary>Or enter everything by hand</summary>
        <ArticleForm sources={sources ?? []} topics={topics ?? []} action={saveArticle} mode="new" back="/admin/articles/new" />
      </details>
    </section>
  );
}
