import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

export default async function WaitingPage() {
  const { user, profile } = await getViewer();
  if (!user) redirect("/login");
  if (profile?.status === "approved") redirect("/");
  const declined = profile?.status === "rejected";
  return (
    <div className="card narrow">
      <h1>{declined ? "Your account wasn't approved" : "Thanks for signing up"}</h1>
      <p>
        {declined
          ? "The admin didn't approve this account. If you think that's a mistake, please get in touch with the admin directly."
          : "Your account is waiting for the admin's approval. Once it's approved, refresh this page or sign in again to browse the library."}
      </p>
      <p className="muted">Signed in as {user.email}</p>
    </div>
  );
}
