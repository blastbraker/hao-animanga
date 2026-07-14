"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Activity, Cable, Check, Copy, Link2, ShieldCheck, Users } from "lucide-react";
import { api } from "../../lib/api";

type Overview = {
  users: number;
  activeBridges: number;
  pendingJobs: number;
  invitations?: Array<{ id: string; email: string; accepted_at?: string | null }>;
  providers: Array<{ name: string; health: string }>;
};

type CreatedInvitation = { email: string; inviteUrl: string };

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api<Overview>("/admin/overview").then(setData).catch((error: Error) => setMessage(error.message));
  useEffect(() => { void load(); }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setCopied(false);
    setCreated(null);
    try {
      const invitation = await api<CreatedInvitation>("/admin/invitations", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setCreated(invitation);
      setEmail("");
      setMessage("Invite link created. Send it privately to the intended beta member.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitation failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.inviteUrl);
      setCopied(true);
      setMessage("Invite link copied.");
    } catch {
      setMessage("Copy was blocked by the browser. Select the link and copy it manually.");
    }
  }

  return (
    <div className="page inner-page">
      <div className="page-intro">
        <span className="eyebrow">OPERATIONS</span>
        <h1>Admin console</h1>
        <p>Manage invitations, source health, and beta safety without entering the everyday viewing flow.</p>
      </div>
      <div className="stat-grid">
        <Stat icon={<Users />} label="Beta users" value={String(data?.users ?? 0)} />
        <Stat icon={<Cable />} label="Active bridges" value={String(data?.activeBridges ?? 0)} />
        <Stat icon={<Activity />} label="Pending jobs" value={String(data?.pendingJobs ?? 0)} />
        <Stat icon={<ShieldCheck />} label="Security posture" value="RLS" />
      </div>
      <div className="admin-grid">
        <section className="admin-card">
          <div className="section-head">
            <div><span className="eyebrow">ACCESS CONTROL</span><h2>Invitations</h2></div>
          </div>
          <form className="repo-form" onSubmit={invite}>
            <input aria-label="New member email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new-member@example.com" />
            <button className="button primary" disabled={busy}>
              <Link2 /> {busy ? "Creating..." : "Create invite link"}
            </button>
          </form>
          {message && <p role="status">{message}</p>}
          {created && (
            <div className="invite-result">
              <b>One-time link for {created.email}</b>
              <p>This link signs in the recipient. Treat it like a password and send it only to that person.</p>
              <div className="invite-copy-row">
                <input aria-label={`Invitation link for ${created.email}`} readOnly value={created.inviteUrl} onFocus={(event) => event.currentTarget.select()} />
                <button className="button ghost" type="button" onClick={copyInvite}>
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
          <div>
            {data?.invitations?.length ? data.invitations.map((item) => (
              <div className="health-row" key={item.id}>
                <span className={item.accepted_at ? "health-dot good" : "health-dot"} />
                <b>{item.email}</b>
                <span>{item.accepted_at ? "accepted" : "pending"}</span>
              </div>
            )) : <div className="table-empty">No pending invitations.</div>}
          </div>
        </section>
        <section className="admin-card">
          <span className="eyebrow">PROVIDER STATUS</span>
          <h2>Source health</h2>
          {(data?.providers ?? []).map((item) => (
            <div className="health-row" key={item.name}>
              <span className={item.health === "operational" ? "health-dot good" : "health-dot"} />
              <b>{item.name}</b><span>{item.health}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="stat-card"><span>{icon}</span><b>{value}</b><small>{label}</small></div>;
}
