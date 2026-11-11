import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { signIn, signUp } from "../auth-actions";
import Notice from "@/components/Notice";

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const { user } = await getViewer();
  if (user) redirect("/");
  const signup = sp.mode === "signup";

  return (
    <div className="card narrow">
      <h1>{signup ? "Request an account" : "Sign in to the Seed"}</h1>
      <p className="muted">
        {signup
          ? "Once you sign up and confirm your email, you'll get in right away if the admin has put your address on the guest list. Otherwise the admin will review your request."
          : "A vetted research library on the psychology of eating, narrative design, and behavioral design."}
      </p>
      <Notice sp={sp} />
      <form action={signup ? signUp : signIn} className="stack">
        {signup && (
          <label>Your name
            <input name="full_name" required autoComplete="name" />
          </label>
        )}
        <label>Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>Password
          <input name="password" type="password" required minLength={signup ? 8 : undefined}
            autoComplete={signup ? "new-password" : "current-password"} />
          {signup && <span className="hint">At least eight characters.</span>}
        </label>
        <button className="button" type="submit">{signup ? "Request account" : "Sign in"}</button>
      </form>
      <p className="switch">
        {signup
          ? <>Already have an account? <Link href="/login">Sign in</Link></>
          : <>New here? <Link href="/login?mode=signup">Request an account</Link></>}
      </p>
    </div>
  );
}
