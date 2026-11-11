import Link from "next/link";
import { displayDate } from "@/lib/articles";

export default function ArticleCard({ article: a, topics, sourceName, isAdmin }) {
  const date = displayDate(a);
  const meta = [a.authors, sourceName, date, a.resource_type].filter(Boolean);
  return (
    <article className="card article">
      <h2>
        <a href={a.url} target="_blank" rel="noreferrer">{a.title || a.url}</a>
      </h2>
      {meta.length > 0 && <p className="meta">{meta.join(" · ")}</p>}
      {a.publication_details && <p className="meta small">{a.publication_details}</p>}
      {a.related_organizations && <p className="meta small">With {a.related_organizations}</p>}

      {a.summary
        ? <p className="summary">{a.summary}</p>
        : <p className="summary placeholder">Summary to come.</p>}

      <div className="card-foot">
        <div className="tags">
          {topics.map((t) => (
            <Link key={t.id} href={`/?topic=${t.id}`} className="tag">{t.name}</Link>
          ))}
        </div>
        <div className="flags">
          {a.internal && <span className="flag warn">Internal</span>}
          {a.summary_origin === "ai_draft" && <span className="flag">AI-drafted summary</span>}
          {isAdmin && a.summary_needs_review && <span className="flag warn">Summary needs review</span>}
          {isAdmin && <Link className="edit" href={`/admin/articles/${a.id}`}>Edit</Link>}
        </div>
      </div>
    </article>
  );
}
