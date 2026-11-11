import { requireAdmin } from "@/lib/auth";
import ArticleForm from "@/components/ArticleForm";
import Notice from "@/components/Notice";
import { saveArticle } from "../../actions";

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
      <p className="muted">Articles you add here go straight into the library.</p>
      <Notice sp={sp} />
      <ArticleForm sources={sources ?? []} topics={topics ?? []} action={saveArticle} mode="new" back="/admin/articles/new" />
    </section>
  );
}
