import { lookup } from "node:dns/promises";
import net from "node:net";
import { extractText, getDocumentProxy } from "unpdf";
import { openAccessUrls } from "@/lib/openaccess";

// Downloads an article's own web page or PDF and returns its readable text, or null.
// Used so the research assistant can read articles, not only their summaries.

const MAX_BYTES = 15 * 1024 * 1024;
const MIN_CHARS = 800;          // shorter than this is a paywall, cookie wall or error page
const FULL_PAPER_CHARS = 6000;  // less than this is usually just an abstract page
const MAX_CHARS = 400_000;
const TIMEOUT_MS = 20_000;
const SKIP_HOSTS = /(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/;   // needs a sign-in

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
         (v.startsWith("::ffff:") && isPrivateIp(v.slice(7)));
}

// Only public http(s) addresses. Stops a pasted link from making the server read its own network.
async function assertPublic(urlString) {
  const u = new URL(urlString);
  if (!/^https?:$/.test(u.protocol)) throw new Error("not http");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("private host");
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error("private ip"); return u; }
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("private ip");
  return u;
}

async function download(urlString) {
  let current = urlString;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublic(current);
    const res = await fetch(u, {
      redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "TheSeedLibraryBot/1.0", accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("too large");
    const chunks = [];
    let total = 0;
    for await (const c of res.body) {
      total += c.length;
      if (total > MAX_BYTES) throw new Error("too large");
      chunks.push(c);
    }
    return { buf: Buffer.concat(chunks), type: (res.headers.get("content-type") ?? "").toLowerCase(), url: u.toString() };
  }
  throw new Error("too many redirects");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

function htmlToText(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<article\b[\s\S]*?<\/article>/i.exec(h)?.[0] ?? /<main\b[\s\S]*?<\/main>/i.exec(h)?.[0];
  if (main && main.length > 3000) h = main;
  return h.replace(/<\/(p|div|h[1-6]|li|tr|section|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\f\v ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Text of a PDF held in memory (an uploaded file), or null if it has too little readable text (a scan).
export async function pdfBufferText(buf) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = String(text ?? "").replace(/\u0000/g, "").trim();
    return clean.length >= MIN_CHARS ? clean.slice(0, MAX_CHARS) : null;
  } catch {
    return null;
  }
}

export async function fetchArticleText(url) {
  try {
    if (SKIP_HOSTS.test(new URL(url).hostname)) return null;
    const { buf, type } = await download(url);
    let text;
    if (type.includes("pdf") || buf.subarray(0, 5).toString() === "%PDF-") {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } else if (type.includes("html") || type.includes("text")) {
      text = htmlToText(buf.toString("utf8"));
    } else return null;
    text = String(text ?? "").replace(/\u0000/g, "").trim();
    return text.length >= MIN_CHARS ? text.slice(0, MAX_CHARS) : null;
  } catch {
    return null;
  }
}

// Fetches text for these articles ({ id, url }) a few at a time and stores it. Returns how many were saved.
export async function fillTexts(supabase, rows, concurrency = 4) {
  let saved = 0;
  const queue = [...rows];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const r = queue.shift();
      let text = await fetchArticleText(r.url);
      if (!text || text.length < FULL_PAPER_CHARS) {   // paywalled, blocked, or only an abstract: try free copies, keep the longest
        for (const u of await openAccessUrls({ url: r.url, title: r.title })) {
          if (u === r.url) continue;
          const t = await fetchArticleText(u);
          if (t && t.length > (text?.length ?? 0)) text = t;
          if (text && text.length >= FULL_PAPER_CHARS) break;
        }
      }
      if (!text) continue;
      const { error } = await supabase.from("articles").update({ full_text: text }).eq("id", r.id).is("full_text", null);
      if (!error) saved++;
    }
  }));
  return saved;
}
