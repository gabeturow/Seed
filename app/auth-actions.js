"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { text, withMsg } from "@/lib/forms";

export async function signIn(fd) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: text(fd, "email") ?? "",
    password: String(fd.get("password") ?? ""),
  });
  if (error) redirect(withMsg("/login", "That email and password didn't match. Please try again.", "error"));
  redirect("/");
}

export async function signUp(fd) {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) redirect(withMsg("/login?mode=signup", "Please choose a password of at least eight characters.", "error"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: text(fd, "email") ?? "",
    password,
    options: { data: { full_name: text(fd, "full_name") ?? "" } },
  });
  if (error) redirect(withMsg("/login?mode=signup", error.message, "error"));
  if (!data.session) redirect(withMsg("/login", "Check your email for a link to confirm your address, then sign in here."));
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
