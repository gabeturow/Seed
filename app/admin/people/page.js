import { requireAdmin } from "@/lib/auth";
import Notice from "@/components/Notice";
import { addAccessEmails, removeAccessEmail, updatePerson } from "../actions";

function PersonButton({ id, change, children, kind = "secondary" }) {
  return (
    <form action={updatePerson} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="change" value={change} />
      <button className={`button small ${kind}`}>{children}</button>
    </form>
  );
}

// One of the two email lists: who is on it, plus a box to add more.
function EmailList({ title, blurb, tier, entries, accounts }) {
  return (
    <section className="card">
      <h2>{title} ({entries.length})</h2>
      <p className="muted">{blurb}</p>
      <ul className="plain">
        {entries.length === 0 && <li className="muted">No one yet.</li>}
        {entries.map((e) => (
          <li key={e.email} className="person">
            <div>
              {e.email}
              {accounts[e.email]
                ? <span className="flag">{accounts[e.email] === "approved" ? "has an account" : `account ${accounts[e.email]}`}</span>
                : <span className="flag">no account yet</span>}
            </div>
            <form action={removeAccessEmail} className="inline-form">
              <input type="hidden" name="email" value={e.email} />
              <button className="button small danger">Remove</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addAccessEmails} className="stack email-add">
        <input type="hidden" name="tier" value={tier} />
        <label>Add emails
          <textarea name="emails" rows={3} placeholder="One per line, or separated by commas" />
        </label>
        <div className="actions"><button className="button">Add to this list</button></div>
      </form>
    </section>
  );
}

export default async function PeoplePage({ searchParams }) {
  const sp = await searchParams;
  const { supabase, user } = await requireAdmin();
  const [{ data: people }, { data: listed, error: listError }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("access_emails").select("email, tier").order("email"),
  ]);
  const groups = {
    pending: (people ?? []).filter((p) => p.status === "pending"),
    approved: (people ?? []).filter((p) => p.status === "approved"),
    rejected: (people ?? []).filter((p) => p.status === "rejected"),
  };
  const accounts = Object.fromEntries((people ?? []).map((p) => [p.email.toLowerCase(), p.status]));
  const staffList = (listed ?? []).filter((e) => e.tier === "staff");
  const publicList = (listed ?? []).filter((e) => e.tier === "public");
  const isStaff = (p) => p.role === "admin" || p.tier === "staff";

  const Row = ({ p, children }) => (
    <li className="person">
      <div>
        <strong>{p.full_name || "No name given"}</strong> <span className="muted">{p.email}</span>
        {p.role === "admin" && <span className="flag">admin</span>}
        {p.status === "approved" && p.role !== "admin" && <span className="flag">{p.tier === "staff" ? "BITE staff" : "public"}</span>}
        {p.id === user.id && <span className="flag">you</span>}
      </div>
      {p.id !== user.id && <div className="person-actions">{children}</div>}
    </li>
  );

  return (
    <>
      <h1>People</h1>
      <p className="muted">
        Two kinds of members: <strong>BITE staff</strong> can see everything, including materials marked internal.
        <strong> Public</strong> members see the public library only. Nobody gets in until they're approved.
      </p>
      <Notice sp={sp} />

      {listError && (
        <p className="notice error">
          The email lists aren't set up yet. Run <code>database/update-access.sql</code> in Supabase (SQL Editor), then reload this page.
        </p>
      )}

      {!listError && (
        <>
          <h2 className="section-title">Email lists</h2>
          <p className="muted">
            Add an email here and that person is approved automatically as soon as they sign up and confirm their address.
            If they already have an account, it changes right away.
          </p>
          <EmailList title="BITE staff" tier="staff" entries={staffList} accounts={accounts}
            blurb="Can see all materials, internal and public." />
          <EmailList title="Public" tier="public" entries={publicList} accounts={accounts}
            blurb="Can see the public library only. Internal materials stay hidden from them." />
        </>
      )}

      <h2 className="section-title">Accounts</h2>

      <section className="card">
        <h2>Waiting for approval ({groups.pending.length})</h2>
        {groups.pending.length === 0 && <p className="muted">No one is waiting.</p>}
        <ul className="plain">
          {groups.pending.map((p) => (
            <Row key={p.id} p={p}>
              <PersonButton id={p.id} change="approve_staff" kind="">Approve as staff</PersonButton>
              <PersonButton id={p.id} change="approve_public" kind="">Approve as public</PersonButton>
              <PersonButton id={p.id} change="decline" kind="danger">Decline</PersonButton>
            </Row>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Approved ({groups.approved.length})</h2>
        <ul className="plain">
          {groups.approved.map((p) => (
            <Row key={p.id} p={p}>
              {p.role !== "admin" && (isStaff(p)
                ? <PersonButton id={p.id} change="make_public">Make public</PersonButton>
                : <PersonButton id={p.id} change="make_staff">Make staff</PersonButton>)}
              {p.role === "admin"
                ? <PersonButton id={p.id} change="make_partner">Make partner</PersonButton>
                : <PersonButton id={p.id} change="make_admin">Make admin</PersonButton>}
              <PersonButton id={p.id} change="decline" kind="danger">Remove access</PersonButton>
            </Row>
          ))}
        </ul>
      </section>

      {groups.rejected.length > 0 && (
        <section className="card">
          <h2>Declined ({groups.rejected.length})</h2>
          <ul className="plain">
            {groups.rejected.map((p) => (
              <Row key={p.id} p={p}>
                <PersonButton id={p.id} change="approve_public">Approve as public</PersonButton>
                <PersonButton id={p.id} change="approve_staff">Approve as staff</PersonButton>
              </Row>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
