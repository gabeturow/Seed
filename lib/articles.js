// Shared database helpers for articles.

// Returns { articleId: [{id, name}, ...] } for the given article ids.
export async function loadTopicsFor(supabase, articleIds) {
  if (!articleIds.length) return {};
  const { data } = await supabase
    .from("article_topics")
    .select("article_id, topics(id, name)")
    .in("article_id", articleIds);
  const out = {};
  for (const row of data ?? []) {
    if (!row.topics) continue;
    (out[row.article_id] ??= []).push(row.topics);
  }
  for (const k in out) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Replace an article's topics with the given list of topic ids.
export async function setTopics(supabase, articleId, topicIds) {
  await supabase.from("article_topics").delete().eq("article_id", articleId);
  if (topicIds.length) {
    const { error } = await supabase
      .from("article_topics")
      .insert(topicIds.map((topic_id) => ({ article_id: articleId, topic_id })));
    if (error) throw new Error(error.message);
  }
}

export function displayDate(a) {
  if (a.publication_date) {
    return new Date(a.publication_date + "T00:00:00").toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  }
  return a.publication_year ? String(a.publication_year) : null;
}

// The links shown for an article: its public page (the DOI when known, else the article's own web link) and, when a
// PDF is stored on the site, the PDF. A shared Drive copy is only used as the page when there is nothing better.
const isDrive = (u) => /(^|\.)(drive|docs)\.google\.com/i.test(String(u ?? "").replace(/^https?:\/\//, "").split("/")[0]);
export function articleLinks(a) {
  const pdf = a.pdf_path ? `/library/${a.id}/pdf` : null;
  const own = a.source_url || (a.url && !a.url.startsWith("/library/") ? a.url : null);
  const page = a.doi ? `https://doi.org/${a.doi}` : own && (!isDrive(own) || !pdf) ? own : null;
  return { page, pdf, pageLabel: a.doi ? "Publisher page" : "Original" };
}
