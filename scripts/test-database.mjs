// Tests the database design and permission rules on a throwaway copy of Postgres
// that runs on this computer (no Supabase account needed).
// Run with: npm run test-db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const setupSql = readFileSync(join(root, "database", "setup.sql"), "utf8");
const pg = new PGlite();

// A minimal stand-in for the parts of Supabase the Seed relies on.
await pg.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`);

let passed = 0, failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label} ${detail}`); }
}

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const PARTNER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";

// Run a query as a particular signed-in person (or signed out with id=null).
async function as(id, sql, params = []) {
  await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '${id ?? ""}', false);`);
  await pg.exec(id ? "set role authenticated" : "set role anon");
  try { return await pg.query(sql, params); }
  finally { await pg.exec("reset role"); }
}
async function fails(id, sql) {
  try { await as(id, sql); return false; } catch { return true; }
}

console.log("\nSetting up the database (twice, to prove it's safe to re-run)...");
await pg.exec(setupSql);
await pg.exec(setupSql);
const count = async (t, where = "true") => (await pg.query(`select count(*)::int n from ${t} where ${where}`)).rows[0].n;
check("102 sources loaded", (await count("public.sources")) === 102);
check("53 topics loaded", (await count("public.topics")) === 53);
check("20 articles loaded into the library", (await count("public.articles", "status='approved'")) === 20);
check("5 Drive items waiting in the review queue", (await count("public.articles", "status='pending'")) === 5);
check("every article has a source", (await count("public.articles", "source_id is null")) === 0);
check("every article has topics",
  (await count("public.articles a", "not exists (select 1 from public.article_topics t where t.article_id=a.id)")) === 0);
check("Food + Planet is spelled with the plus sign", (await count("public.sources", "name='Food + Planet'")) === 1);

console.log("\nSign-ups...");
await pg.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${ADMIN}', 'admin@example.test', '{"full_name":"Admin Person"}'),
  ('${PARTNER}', 'partner@example.test', '{"full_name":"Partner One"}'),
  ('${OTHER}', 'other@example.test', '{}');`);
const prof = async (id) => (await pg.query("select role, status from public.profiles where id=$1", [id])).rows[0];
check("first sign-up becomes an approved admin", JSON.stringify(await prof(ADMIN)) === '{"role":"admin","status":"approved"}');
check("later sign-ups are pending partners", JSON.stringify(await prof(PARTNER)) === '{"role":"partner","status":"pending"}');

check("signed-out visitors can't read anything", await fails(null, "select * from public.articles"));
let r = await as(PARTNER, "select * from public.search_articles(null)");
check("pending partner sees no articles yet", r.rows.length === 0);

await as(PARTNER, `update public.profiles set role='admin', status='approved' where id='${PARTNER}'`);
check("partner can't approve themself or make themself admin",
  JSON.stringify(await prof(PARTNER)) === '{"role":"partner","status":"pending"}');

await as(ADMIN, `update public.profiles set status='approved' where id in ('${PARTNER}','${OTHER}')`);
check("admin approves new partners", (await prof(PARTNER)).status === "approved");

console.log("\nBrowsing and search...");
r = await as(PARTNER, "select * from public.search_articles(null)");
check("approved partner sees all 20 library articles", r.rows.length === 20);
r = await as(PARTNER, "select title from public.search_articles('defaults')");
check("keyword search 'defaults' finds the Greener by Default guide",
  r.rows.some((x) => x.title.includes("Greener by Default")), JSON.stringify(r.rows));
r = await as(PARTNER, "select title from public.search_articles('Willett')");
check("search by author name finds EAT-Lancet", r.rows.some((x) => x.title.includes("EAT-Lancet")));
r = await as(PARTNER, "select title from public.search_articles('nudge')");
check("search matches word variants (nudge -> nudges)", r.rows.length >= 1);
const wri = (await pg.query("select id from public.sources where name='World Resources Institute'")).rows[0].id;
r = await as(PARTNER, `select title from public.search_articles(null, null, ${wri})`);
check("filter by source: World Resources Institute has 4", r.rows.length === 4);
const fs = (await pg.query("select id from public.topics where name='foodservice'")).rows[0].id;
r = await as(PARTNER, `select title from public.search_articles(null, ${fs}, null)`);
check("filter by topic: foodservice", r.rows.length >= 3, `got ${r.rows.length}`);
r = await as(PARTNER, `select title from public.search_articles('menu', ${fs}, ${wri})`);
check("keyword + topic + source together", r.rows.length === 3, JSON.stringify(r.rows));

console.log("\nSubmissions and review...");
r = await as(PARTNER, `insert into public.articles (url, submission_note, status, origin, submitted_by)
  values ('https://example.test/new', 'Great study on defaults', 'pending', 'partner', '${PARTNER}') returning id`);
const newId = r.rows[0].id;
check("partner can submit to the pending queue", !!newId);
check("partner can't add straight to the library",
  await fails(PARTNER, `insert into public.articles (url, status, origin, submitted_by) values ('x','approved','partner','${PARTNER}')`));
check("partner can't submit in someone else's name",
  await fails(PARTNER, `insert into public.articles (url, status, origin, submitted_by) values ('x','pending','partner','${OTHER}')`));
check("partner can suggest a topic on their own submission",
  !(await fails(PARTNER, `insert into public.article_topics values (${newId}, ${fs})`)));
r = await as(PARTNER, "select id from public.articles where status='pending'");
check("partner sees their own pending submission", r.rows.length === 1);
r = await as(OTHER, "select id from public.articles where status='pending'");
check("other partners don't see it", r.rows.length === 0);
r = await as(PARTNER, "select * from public.search_articles(null)");
check("pending submissions are not in the library", r.rows.length === 20);
r = await as(OTHER, "select public.article_url_status('HTTPS://example.test/new/') s");
check("duplicate check spots a link that's already pending", r.rows[0].s === "pending");
r = await as(OTHER, "select public.article_url_status('https://example.test/brand-new') s");
check("duplicate check says a new link is new", r.rows[0].s === null);

await as(PARTNER, "update public.articles set title='hacked' where status='approved'");
check("partner can't edit library articles", (await count("public.articles", "title='hacked'")) === 0);
await as(PARTNER, "delete from public.articles");
check("partner can't delete library articles", (await count("public.articles")) === 26);
await as(PARTNER, "insert into public.topics (name) values ('partner tag')").catch(() => {});
check("partner can't add topics", (await count("public.topics", "name='partner tag'")) === 0);
await as(PARTNER, "delete from public.sources").catch(() => {});
check("partner can't delete sources", (await count("public.sources")) === 102);

await as(ADMIN, `update public.articles set status='approved', title='A new defaults study',
  reviewed_by='${ADMIN}', reviewed_at=now() where id=${newId}`);
r = await as(OTHER, "select title from public.search_articles('defaults')");
check("once the admin approves it, everyone can find it", r.rows.some((x) => x.title === "A new defaults study"));
await as(ADMIN, "insert into public.topics (name) values ('psychology of eating')");
check("admin can add topics", (await count("public.topics", "name='psychology of eating'")) === 1);
await as(ADMIN, `delete from public.articles where id=${newId}`);
check("admin can delete articles", (await count("public.articles")) === 25);

console.log("\nStaff vs. public access...");
const STAFF = "00000000-0000-0000-0000-0000000000d1";
const PUB = "00000000-0000-0000-0000-0000000000d2";
const STRANGER = "00000000-0000-0000-0000-0000000000d3";
const UNCONFIRMED = "00000000-0000-0000-0000-0000000000d4";
await as(ADMIN, `insert into public.access_emails (email, tier) values
  ('staff@bite.test', 'staff'), ('public@friends.test', 'public'), ('later@bite.test', 'staff')`);
check("only the admin can read or change the email lists",
  (await as(PARTNER, "select * from public.access_emails")).rows.length === 0
  && await fails(PARTNER, "insert into public.access_emails (email, tier) values ('x@y.test','staff')"));
check("email lists must be lowercase", await fails(ADMIN, "insert into public.access_emails (email, tier) values ('Loud@Y.test','staff')"));

await pg.exec(`insert into auth.users (id, email, email_confirmed_at) values
  ('${STAFF}', 'staff@bite.test', now()),
  ('${PUB}', 'Public@Friends.test', now()),
  ('${STRANGER}', 'stranger@elsewhere.test', now()),
  ('${UNCONFIRMED}', 'later@bite.test', null)`);
const tierOf = async (id) => (await pg.query("select status, tier from public.profiles where id=$1", [id])).rows[0];
check("a listed staff email is approved as staff", JSON.stringify(await tierOf(STAFF)) === '{"status":"approved","tier":"staff"}');
check("a listed public email is approved as public (any capitalization)", JSON.stringify(await tierOf(PUB)) === '{"status":"approved","tier":"public"}');
check("an unlisted email still waits for approval", JSON.stringify(await tierOf(STRANGER)) === '{"status":"pending","tier":"public"}');
check("a listed email waits until the address is confirmed", (await tierOf(UNCONFIRMED)).status === "pending");
await pg.exec(`update auth.users set email_confirmed_at = now() where id = '${UNCONFIRMED}'`);
check("...and is approved as staff once it is confirmed", JSON.stringify(await tierOf(UNCONFIRMED)) === '{"status":"approved","tier":"staff"}');
await as(STAFF, `update public.profiles set tier='public' where id='${STAFF}'`);
await as(PUB, `update public.profiles set tier='staff' where id='${PUB}'`);
check("people can't change their own access level",
  (await tierOf(STAFF)).tier === "staff" && (await tierOf(PUB)).tier === "public");

const internalId = (await as(ADMIN, `insert into public.articles (url, title, status, origin, internal, submitted_by)
  values ('https://example.test/internal', 'Bite internal playbook', 'approved', 'admin', true, '${ADMIN}') returning id`)).rows[0].id;
const titles = async (id) => (await as(id, "select title from public.search_articles(null)")).rows.map((x) => x.title);
check("staff see internal articles", (await titles(STAFF)).includes("Bite internal playbook"));
check("the admin sees internal articles", (await titles(ADMIN)).includes("Bite internal playbook"));
check("public members don't see internal articles", !(await titles(PUB)).includes("Bite internal playbook"));
check("public members still see the 20 public ones", (await titles(PUB)).length === 20);
check("public members can't find internal articles by searching",
  !(await as(PUB, "select title from public.search_articles('playbook')")).rows.some((x) => x.title === "Bite internal playbook"));
check("public members can't read internal articles directly",
  (await as(PUB, `select id from public.articles where id=${internalId}`)).rows.length === 0);
check("the duplicate check hides internal articles from public members",
  (await as(PUB, "select public.article_url_status('https://example.test/internal') s")).rows[0].s === null);
check("the duplicate check still works for staff",
  (await as(STAFF, "select public.article_url_status('https://example.test/internal') s")).rows[0].s === "approved");
check("public members can't submit an internal article",
  await fails(PUB, `insert into public.articles (url, status, origin, submitted_by, internal) values ('y','pending','partner','${PUB}',true)`));

const shared = async (id, internal) => (await as(id, `insert into public.shared_answers (doc, internal) values ('{}'::jsonb, ${internal}) returning id`)).rows[0].id;
const sharedInternal = await shared(STAFF, true), sharedPublic = await shared(STAFF, false);
check("public members can open a shared answer that is public", (await as(PUB, `select id from public.shared_answers where id='${sharedPublic}'`)).rows.length === 1);
check("public members can't open a shared answer that uses internal articles", (await as(PUB, `select id from public.shared_answers where id='${sharedInternal}'`)).rows.length === 0);
check("staff can open both", (await as(STAFF, "select id from public.shared_answers")).rows.length === 2);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
