// Finds legal free copies of a paper through public scholarly indexes (no sign-in, no scraping):
//   - OpenAlex (open index of scholarly works)
//   - Semantic Scholar (its "open access PDF" links)
//   - Europe PMC (free full text in PubMed Central / Europe PMC)
//   - Unpaywall (only when UNPAYWALL_EMAIL is set: Unpaywall asks callers for a contact email)
// Used when an article's own link is paywalled or blocks automated reading. Returns a few URLs to try, best first.
const OPENALEX = "https://api.openalex.org/works";
const S2 = "https://api.semanticscholar.org/graph/v1/paper";
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const UNPAYWALL = "https://api.unpaywall.org/v2";
const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL?.trim() || null;

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

// A DOI inside a link such as https://doi.org/10.3390/g12010002 or .../doi/abs/10.1177/0013916512469099.
export function doiFrom(url) {
  const m = /10\.\d{4,9}\/[^\s?#]+/i.exec(decodeURIComponent(String(url ?? "")));
  return m ? m[0].replace(/[.,;)]+$/, "") : null;
}
const bareDoi = (d) => (d ? String(d).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : null);

const sameTitle = (a, b) => {
  const x = words(a), y = words(b);
  if (x.size < 3 || y.size < 3) return false;
  const hit = [...x].filter((w) => y.has(w)).length;
  return hit / x.size >= 0.9 && hit / y.size >= 0.8;
};

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// OpenAlex: also tells us the DOI when we only have a title, which the other services need.
const OA_SELECT = "select=title,doi,best_oa_location,primary_location,locations";
async function fromOpenAlex(doi, title) {
  let w = doi ? await getJson(`${OPENALEX}/doi:${encodeURIComponent(`https://doi.org/${doi}`)}?${OA_SELECT}`) : null;
  if (!w && title) {
    const body = await getJson(`${OPENALEX}?search=${encodeURIComponent(String(title).slice(0, 250))}&per-page=3&${OA_SELECT}`);
    w = (body?.results ?? []).find((r) => sameTitle(title, r.title)) ?? null;
  }
  if (!w) return { urls: [], doi: null };
  const urls = [];
  for (const l of [w.best_oa_location, w.primary_location, ...(w.locations ?? [])]) {
    if (!l?.is_oa) continue;
    for (const u of [l.pdf_url, l.landing_page_url]) if (u) urls.push(u);
  }
  return { urls, doi: bareDoi(w.doi) };
}

async function fromSemanticScholar(doi, title) {
  let p = doi ? await getJson(`${S2}/DOI:${encodeURIComponent(doi)}?fields=title,openAccessPdf`) : null;
  if (!p && title) {
    const body = await getJson(`${S2}/search/match?query=${encodeURIComponent(String(title).slice(0, 250))}&fields=title,openAccessPdf`);
    const m = body?.data?.[0];
    if (m && sameTitle(title, m.title)) p = m;
  }
  return p?.openAccessPdf?.url ? [p.openAccessPdf.url] : [];
}

async function fromEuropePmc(doi, title) {
  const q = doi ? `DOI:"${doi}"` : title ? `TITLE:"${String(title).replace(/"/g, " ").slice(0, 200)}"` : null;
  if (!q) return [];
  const body = await getJson(`${EPMC}?query=${encodeURIComponent(q)}&format=json&resultType=core&pageSize=3`);
  const r = (body?.resultList?.result ?? []).find((x) => (doi ? bareDoi(x.doi)?.toLowerCase() === doi.toLowerCase() : sameTitle(title, x.title)));
  if (!r) return [];
  const out = [];
  if (r.pmcid && r.isOpenAccess === "Y") out.push(`https://europepmc.org/articles/${r.pmcid}`);
  for (const f of r.fullTextUrlList?.fullTextUrl ?? []) {
    if (f.availabilityCode === "OA" || f.availabilityCode === "F") out.push(f.url);
  }
  return out;
}

async function fromUnpaywall(doi) {
  if (!doi || !UNPAYWALL_EMAIL) return [];
  const w = await getJson(`${UNPAYWALL}/${encodeURIComponent(doi)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`);
  const out = [];
  for (const l of [w?.best_oa_location, ...(w?.oa_locations ?? [])]) {
    for (const u of [l?.url_for_pdf, l?.url_for_landing_page]) if (u) out.push(u);
  }
  return out;
}

export async function openAccessUrls({ url, title }) {
  try {
    const oa = await fromOpenAlex(doiFrom(url), title);
    const doi = doiFrom(url) ?? oa.doi;
    const lists = await Promise.all([
      fromUnpaywall(doi), fromSemanticScholar(doi, title), fromEuropePmc(doi, title),
    ]);
    // PDFs first (they hold the whole paper), then landing pages; no repeats, and not the link we already tried.
    const all = [...lists[0], ...oa.urls, ...lists[1], ...lists[2]].filter((u) => u && u !== url);
    const unique = [...new Set(all)];
    const isPdf = (u) => /\.pdf($|[?#])|\/pdf\//i.test(u);
    return [...unique.filter(isPdf), ...unique.filter((u) => !isPdf(u))].slice(0, 8);
  } catch { /* the lookup is a bonus; fall through */ }
  return [];
}
