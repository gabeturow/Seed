// Caches lookups that cost time and money: outside web searches and article readings.
//
// Two layers:
//   1. Memory in the running server (fast, cleared on restart).
//   2. The lookup_cache table in Supabase (shared by every server instance, survives restarts).
//      Needs CACHE_SECRET. Every row is signed with it, so a row someone planted by hand is ignored.
//      Keys are hashes, so questions are not stored readably. Results from internal articles are marked internal
//      (staff only), and that mark is covered by the signature.
//
// Nothing user-specific is stored. Callers check who may see a result before using the cache.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const store = new Map();      // key -> { value, expires } or { pending, expires }
const MAX_ENTRIES = 500;
const SECRET = process.env.CACHE_SECRET?.trim();

export const normalizeKey = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const hashOf = (s) => createHash("sha1").update(String(s)).digest("hex").slice(0, 16);

const dayStamp = () => new Date().toISOString().slice(0, 10);          // a new key each day, so old rows are never reused
const dbKey = (key) => createHash("sha256").update(`${key}|${dayStamp()}`).digest("hex");
const sign = (key, internal, expiresAt, payload) =>
  createHmac("sha256", SECRET).update(`${key}\n${internal ? 1 : 0}\n${expiresAt}\n${payload}`).digest("hex");
const sameSig = (a, b) => { try { const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex"); return x.length === y.length && timingSafeEqual(x, y); } catch { return false; } };

async function readShared(supabase, key) {
  try {
    const k = dbKey(key);
    const { data } = await supabase.from("lookup_cache").select("internal, payload, sig, expires_at").eq("key", k).maybeSingle();
    if (!data || new Date(data.expires_at) <= new Date()) return undefined;
    if (!sameSig(data.sig, sign(k, data.internal, new Date(data.expires_at).toISOString(), data.payload))) return undefined;
    return { value: JSON.parse(data.payload), expires: new Date(data.expires_at).getTime() };
  } catch { return undefined; }
}

async function writeShared(supabase, key, value, ttlMs, internal) {
  try {
    const k = dbKey(key);
    const payload = JSON.stringify(value);
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await supabase.from("lookup_cache").insert({ key: k, internal, payload, expires_at: expiresAt, sig: sign(k, internal, expiresAt, payload) });
    if (Math.random() < 0.02) await supabase.from("lookup_cache").delete().lt("expires_at", new Date().toISOString());   // tidy up now and then
  } catch { /* the cache is a convenience; never fail a question over it */ }
}

// Runs fn() unless the same key was answered recently. Callers asking at the same moment share one run.
// `worthKeeping(value)` can refuse to store a result (for example an empty search), so it is retried next time.
// `shared` ({ supabase, internal }) turns on the Supabase layer.
export async function cached(key, ttlMs, fn, worthKeeping = () => true, shared = null) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.pending ? hit.pending : structuredClone(hit.value);
  const useShared = Boolean(shared?.supabase && SECRET);
  const pending = (async () => {
    try {
      if (useShared) {
        const found = await readShared(shared.supabase, key);
        if (found) {
          store.delete(key);
          store.set(key, { value: found.value, expires: found.expires });
          return structuredClone(found.value);
        }
      }
      const value = await fn();
      if (worthKeeping(value)) {
        store.delete(key);
        store.set(key, { value, expires: Date.now() + ttlMs });
        while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);   // drop the oldest
        if (useShared) await writeShared(shared.supabase, key, value, ttlMs, Boolean(shared.internal));
      } else store.delete(key);
      return structuredClone(value);
    } catch (err) {
      store.delete(key);
      throw err;
    }
  })();
  store.set(key, { pending, expires: now + 120_000 });
  return pending;
}
