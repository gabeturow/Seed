import { redirect } from "next/navigation";
import { createClient, isConfigured } from "./supabase";

// Who is looking at the page? Returns { supabase, user, profile } (user/profile may be null).
export async function getViewer() {
  if (!isConfigured) return { supabase: null, user: null, profile: null };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return { supabase, user, profile };
}

export async function requireApproved() {
  const viewer = await getViewer();
  if (!viewer.user) redirect("/login");
  if (viewer.profile?.status !== "approved") redirect("/waiting");
  const isAdmin = viewer.profile.role === "admin";
  // Staff (and the admin) can see internal materials; everyone else sees the public library only.
  return { ...viewer, isAdmin, isStaff: isAdmin || viewer.profile.tier === "staff" };
}

export async function requireAdmin() {
  const viewer = await requireApproved();
  if (!viewer.isAdmin) redirect("/");
  return viewer;
}
