"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setTopics } from "@/lib/articles";
import { cleanUrl, ids, int, text, withMsg } from "@/lib/forms";

function articleFields(fd) {
  return {
    url: cleanUrl(text(fd, "url")),
    title: text(fd, "title"),
    authors: text(fd, "authors"),
    source_id: int(fd, "source_id"),
    resource_type: text(fd, "resource_type"),
    publication_date: text(fd, "publication_date"),
    publication_year: int(fd, "publication_year") ?? (text(fd, "publication_date") ? Number(text(fd, "publication_date").slice(0, 4)) : null),
    related_organizations: text(fd, "related_organizations"),
    publication_details: text(fd, "publication_details"),
    summary: text(fd, "summary"),
    summary_origin: text(fd, "summary_origin") ?? (text(fd, "summary") ? "human" : null),
    summary_needs_review: fd.get("summary_needs_review") === "on",
    admin_notes: text(fd, "admin_notes"),
    internal: fd.get("internal") === "on",
  };
}

const done = (back, msg) => {
  revalidatePath("/", "layout");
  redirect(withMsg(back, msg));
};

// ---------- Articles ----------
export async function saveArticle(fd) {
  const { supabase, user } = await requireAdmin();
  const id = int(fd, "id");
  const intent = text(fd, "intent");
  const back = text(fd, "back") ?? "/";
  const fail = (m) => redirect(withMsg(back, m, "error"));

  if (intent === "reject") {
    const { error } = await supabase.from("articles").update({
      status: "rejected", review_note: text(fd, "review_note"),
      reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) fail(error.message);
    done(back, "Rejected. It won't appear in the library.");
  }

  const fields = articleFields(fd);
  if (!fields.url) fail("Every article needs a link.");

  if (intent === "create") {
    const { data, error } = await supabase.from("articles").insert({
      ...fields, status: "approved", origin: "admin",
      submitted_by: user.id, reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).select("id").single();
    if (error) fail(error.message);
    await setTopics(supabase, data.id, ids(fd, "topic_ids"));
    done("/", `Added “${fields.title ?? fields.url}” to the library.`);
  }

  const update = { ...fields };
  if (intent === "approve") Object.assign(update, {
    status: "approved", review_note: text(fd, "review_note"),
    reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  });
  if (intent === "save" && fd.has("review_note")) update.review_note = text(fd, "review_note");

  const { error } = await supabase.from("articles").update(update).eq("id", id);
  if (error) fail(error.message);
  await setTopics(supabase, id, ids(fd, "topic_ids"));
  done(back, intent === "approve" ? "Approved. It's now in the library." : "Saved.");
}

export async function deleteArticle(fd) {
  const { supabase } = await requireAdmin();
  if (fd.get("confirm") !== "on") redirect(withMsg(`/admin/articles/${int(fd, "id")}`, "Tick the box to confirm the deletion.", "error"));
  const { error } = await supabase.from("articles").delete().eq("id", int(fd, "id"));
  if (error) redirect(withMsg(`/admin/articles/${int(fd, "id")}`, error.message, "error"));
  done(text(fd, "back") ?? "/", "Deleted the article.");
}

export async function setArticleStatus(fd) {
  const { supabase, user } = await requireAdmin();
  const status = text(fd, "status");
  if (!["approved", "pending", "rejected"].includes(status)) return;
  await supabase.from("articles").update({
    status, reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).eq("id", int(fd, "id"));
  done(text(fd, "back") ?? "/admin/review", "Updated.");
}

// ---------- Sources ----------
export async function saveSource(fd) {
  const { supabase } = await requireAdmin();
  const id = int(fd, "id");
  const row = {
    name: text(fd, "name"),
    website_url: cleanUrl(text(fd, "website_url")),
    notes: text(fd, "notes"),
    scout_enabled: fd.get("scout_enabled") === "on",
  };
  if (!row.name) redirect(withMsg("/admin/sources", "A source needs a name.", "error"));
  const { error } = id
    ? await supabase.from("sources").update(row).eq("id", id)
    : await supabase.from("sources").insert(row);
  if (error) redirect(withMsg("/admin/sources", error.code === "23505" ? "There's already a source with that name." : error.message, "error"));
  done("/admin/sources", id ? `Saved ${row.name}.` : `Added ${row.name}.`);
}

export async function deleteSource(fd) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("sources").delete().eq("id", int(fd, "id"));
  if (error) redirect(withMsg("/admin/sources", error.message, "error"));
  done("/admin/sources", "Removed the source. Any articles from it now show no source.");
}

// ---------- Topics ----------
export async function saveTopic(fd) {
  const { supabase } = await requireAdmin();
  const id = int(fd, "id");
  const name = text(fd, "name")?.toLowerCase();
  if (!name) redirect(withMsg("/admin/topics", "A topic needs a name.", "error"));
  const { error } = id
    ? await supabase.from("topics").update({ name }).eq("id", id)
    : await supabase.from("topics").insert({ name });
  if (error) redirect(withMsg("/admin/topics", error.code === "23505" ? "That topic already exists." : error.message, "error"));
  done("/admin/topics", id ? `Renamed to “${name}.”` : `Added “${name}.”`);
}

export async function deleteTopic(fd) {
  const { supabase } = await requireAdmin();
  await supabase.from("topics").delete().eq("id", int(fd, "id"));
  done("/admin/topics", "Removed the topic from the list and from any articles that had it.");
}

// ---------- People ----------
export async function updatePerson(fd) {
  const { supabase, user } = await requireAdmin();
  const id = text(fd, "id");
  const change = text(fd, "change");
  if (id === user.id) redirect(withMsg("/admin/people", "You can't change your own access.", "error"));
  const updates = {
    approve_staff: { status: "approved", tier: "staff" },
    approve_public: { status: "approved", tier: "public" },
    decline: { status: "rejected" },
    make_staff: { tier: "staff" },
    make_public: { tier: "public" },
    make_admin: { role: "admin", status: "approved", tier: "staff" },
    make_partner: { role: "partner" },
  }[change];
  if (!updates) return;
  const { error } = await supabase.from("profiles").update(updates).eq("id", id);
  if (error) redirect(withMsg("/admin/people", error.message, "error"));
  done("/admin/people", "Updated.");
}

// ---------- Email lists (who is let in automatically, and as what) ----------
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export async function addAccessEmails(fd) {
  const { supabase } = await requireAdmin();
  const tier = text(fd, "tier");
  if (!["staff", "public"].includes(tier)) return;
  const all = (text(fd, "emails") ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const emails = [...new Set(all.filter((e) => EMAIL.test(e)))];
  const bad = all.filter((e) => !EMAIL.test(e));
  if (!emails.length) redirect(withMsg("/admin/people", bad.length ? `That doesn't look like an email address: ${bad[0]}` : "Type or paste at least one email address.", "error"));

  const { error } = await supabase.from("access_emails").upsert(emails.map((email) => ({ email, tier })), { onConflict: "email" });
  if (error) redirect(withMsg("/admin/people", error.message.includes("access_emails") ? "The email lists aren't set up yet. Run database/update-access.sql in Supabase first." : error.message, "error"));

  // Anyone listed who already has an account gets this access now.
  await supabase.from("profiles").update({ tier }).in("email", emails);
  await supabase.from("profiles").update({ status: "approved" }).in("email", emails).in("status", ["pending", "rejected"]);
  done("/admin/people", `Added ${emails.length === 1 ? emails[0] : `${emails.length} emails`} to the ${tier === "staff" ? "BITE staff" : "public"} list.${bad.length ? ` Skipped: ${bad.join(", ")}.` : ""}`);
}

export async function removeAccessEmail(fd) {
  const { supabase } = await requireAdmin();
  const email = text(fd, "email")?.toLowerCase();
  if (!email) return;
  const { data: row } = await supabase.from("access_emails").select("tier").eq("email", email).single();
  const { error } = await supabase.from("access_emails").delete().eq("email", email);
  if (error) redirect(withMsg("/admin/people", error.message, "error"));
  // Taking someone off the staff list also ends their staff access (they stay a public member).
  if (row?.tier === "staff") await supabase.from("profiles").update({ tier: "public" }).eq("email", email).neq("role", "admin");
  done("/admin/people", row?.tier === "staff" ? `Removed ${email}. If they have an account, they're now a public member.` : `Removed ${email} from the list. Their account, if any, is unchanged.`);
}
