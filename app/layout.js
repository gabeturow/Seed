import "./globals.css";
import Link from "next/link";
import { getViewer } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase";
import { signOut } from "./auth-actions";

// Every page depends on who is signed in, so never serve a saved copy.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Seed",
  description: "A vetted research library on the psychology of eating, narrative design, and behavioral design.",
};

export default async function RootLayout({ children }) {
  const { user, profile } = await getViewer();
  const approved = profile?.status === "approved";
  const isAdmin = approved && profile?.role === "admin";

  let pendingCount = 0, peopleCount = 0;
  if (isAdmin) {
    const { supabase } = await getViewer();
    const [a, p] = await Promise.all([
      supabase.from("articles").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    pendingCount = a.count ?? 0;
    peopleCount = p.count ?? 0;
  }

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zalando+Sans:wght@400;600&family=Zalando+Sans+SemiExpanded:wght@600;800&display=swap" />
      </head>
      <body>
        <header className="site-header">
          <div className="wrap header-inner">
            <Link href="/" className="brand">
              <span className="brand-word">Seed</span>
              <span className="brand-tag">A research library by Bite</span>
            </Link>
            {approved && (
              <nav className="nav">
                <Link href="/">Library</Link>
                <Link href="/ask">Ask</Link>
                <Link href="/submit">Suggest an article</Link>
                {isAdmin && (
                  <>
                    <Link href="/admin/review">
                      Review{pendingCount > 0 && <span className="count">{pendingCount}</span>}
                    </Link>
                    <Link href="/admin/articles/new">Add</Link>
                    <Link href="/admin/sources">Sources</Link>
                    <Link href="/admin/ai">Scout</Link>
                    <Link href="/admin/topics">Topics</Link>
                    <Link href="/admin/people">
                      People{peopleCount > 0 && <span className="count">{peopleCount}</span>}
                    </Link>
                  </>
                )}
              </nav>
            )}
            {user && (
              <form action={signOut} className="signout">
                <span className="who">{profile?.full_name || user.email}{isAdmin ? " · admin" : approved && profile?.tier === "staff" ? " · staff" : ""}</span>
                <button className="link-button" type="submit">Sign out</button>
              </form>
            )}
          </div>
        </header>
        <main className="wrap main">
          {isConfigured ? children : <SetupNeeded />}
        </main>
      </body>
    </html>
  );
}

function SetupNeeded() {
  return (
    <div className="card narrow">
      <h1>Almost there</h1>
      <p>
        The Seed isn't connected to its database yet. Follow the steps in <strong>HOW-TO-RUN.md</strong> to
        create the Supabase project and paste its two keys into the <code>.env.local</code> file, then restart the site.
      </p>
    </div>
  );
}
