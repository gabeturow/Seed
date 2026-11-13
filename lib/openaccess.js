// Finds legal free copies of a paper through OpenAlex (a free, open index of scholarly works; no account needed).
// Used when an article's own link is paywalled or blocks automated reading. Returns a few URLs to try, best first.
const API = "https://api.openalex.org/works";
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

// A DOI inside a link such as https://doi.org/10.3390/g12010002 or .../doi/abs/10.1177/0013916512469099.
export function doiFrom(url) {
  const m = /10\.\d{4,9}\/[^\s?#]+/i.exec(decodeURIComponent(String(url ?? "")));
  return m ? m[0].replace(/[.,;)]+$/, "") : null;
}

const sameTitle = (a, b) => {
  const x = words(a), y = words(b);
  if (x.size < 3 || y.size < 3) return false;
  const hit = [...x].filter((w) => y.has(w)).length;
  return hit / x.size >= 0.9 && hit / y.size >= 0.8;
};

const urlsOf = (w) => {
  const out = [];
  for (const l of [w.best_oa_location, w.primary_location, ...(w.locations ?? [])]) {
    if (!l?.is_oa) continue;
    for (const u of [l.pdf_url, l.landing_page_url]) if (u && !out.includes(u)) out.push(u);
  }
  return out;
};

async function get(path) {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
  return res.ok ? res.json() : null;
}
const SELECT = "select=title,doi,best_oa_location,primary_location,locations";

export async function openAccessUrls({ url, title }) {
  try {
    const doi = doiFrom(url);
    if (doi) {
      const w = await get(`/doi:${encodeURIComponent(`https://doi.org/${doi}`)}?${SELECT}`);
      const found = w ? urlsOf(w) : [];
      if (found.length) return found.slice(0, 4);
    }
    if (title) {
      const body = await get(`?search=${encodeURIComponent(String(title).slice(0, 250))}&per-page=3&${SELECT}`);
      const w = (body?.results ?? []).find((r) => sameTitle(title, r.title));
      if (w) return urlsOf(w).slice(0, 4);
    }
  } catch { /* the lookup is a bonus; fall through */ }
  return [];
}
