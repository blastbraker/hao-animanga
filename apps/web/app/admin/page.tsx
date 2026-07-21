"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Activity, Cable, Check, Copy, Link2, MessageSquareWarning, Server, ShieldCheck, Users } from "lucide-react";
import { api } from "../../lib/api";

type Overview = {
  users: number;
  activeBridges: number;
  pendingJobs: number;
  bridges?: BridgeDevice[];
  invitations?: Array<{
    id: string;
    email: string;
    accepted_at?: string | null;
  }>;
  providers: Array<{ name: string; health: string }>;
  audit?: AuditEvent[];
};

type AuditEvent = { id?: string; actor_id?: string | null; actorId?: string | null; action: string; metadata?: Record<string, unknown>; created_at?: string; at?: string };

type CreatedInvitation = { email: string; temporaryPassword: string };
type BridgeDevice = {
  id: string;
  name: string;
  endpoint: string | null;
  revokedAt: string | null;
  scope: "personal" | "beta";
  sharedBeta: boolean;
};

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bridges, setBridges] = useState<BridgeDevice[]>([]);
  const [bridgeSelection, setBridgeSelection] = useState("");
  const [sharing, setSharing] = useState(false);

  const load = async () => {
    try {
      const overview = await api<Overview>("/admin/overview");
      const bridgeItems = overview.bridges ?? [];
      setData(overview);
      setBridges(bridgeItems);
      const shared = bridgeItems.find((bridge) => bridge.sharedBeta);
      const firstPersonal = bridgeItems.find((bridge) => bridge.scope === "personal" && !bridge.revokedAt);
      setBridgeSelection(shared?.id ?? firstPersonal?.id ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin data failed");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setCopied(false);
    setCreated(null);
    try {
      const invitation = await api<CreatedInvitation>("/admin/invitations", {
        method: "POST",
        body: JSON.stringify({ email })
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
      await navigator.clipboard.writeText(created.temporaryPassword);
      setCopied(true);
      setMessage("Temporary password copied.");
    } catch {
      setMessage("Copy was blocked by the browser. Select the link and copy it manually.");
    }
  }

  async function updateSharedBridge(bridgeId: string | null) {
    setSharing(true);
    try {
      await api("/admin/shared-bridge", {
        method: "POST",
        body: JSON.stringify({ bridgeId })
      });
      setMessage(bridgeId ? "Managed Beta Bridge enabled. Invited members can use its approved sources without installing anything." : "Managed Beta Bridge disabled.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bridge sharing failed");
    } finally {
      setSharing(false);
    }
  }

  const personalBridges = bridges.filter((bridge) => bridge.scope === "personal" && !bridge.revokedAt);
  const sharedBridge = bridges.find((bridge) => bridge.sharedBeta);
  const feedback = (data?.audit ?? []).filter((item) => item.action === "feedback.submit" || item.action === "source.report");

  return (
    <div className="page inner-page">
      <div className="page-intro">
        <span className="eyebrow">OPERATIONS</span>
        <h1>Admin console</h1>
        <p>Manage invitations, source health, and beta safety without entering the everyday viewing flow.</p>
      </div>
      <div className="stat-grid">
        <Stat icon={<Users />} label="Beta users" value={String(data?.users ?? 0)} />
        <Stat icon={<Cable />} label="Configured bridges" value={String(data?.activeBridges ?? 0)} />
        <Stat icon={<Activity />} label="Pending jobs" value={String(data?.pendingJobs ?? 0)} />
        <Stat icon={<ShieldCheck />} label="Security posture" value="RLS" />
      </div>
      <section className="admin-card shared-bridge-admin">
        <div>
          <span className="eyebrow">MANAGED BETA SOURCES</span>
          <h2>Shared Beta Bridge</h2>
          <p>Testers automatically use the approved sources installed on this Bridge. Media still travels directly between their browser and your Bridge; HAO Cloud does not relay it.</p>
        </div>
        <div className="shared-bridge-controls">
          <select aria-label="Bridge shared with beta members" value={bridgeSelection} onChange={(event) => setBridgeSelection(event.target.value)} disabled={sharing || !personalBridges.length}>
            {!personalBridges.length && <option value="">Pair a Bridge first</option>}
            {personalBridges.map((bridge) => (
              <option key={bridge.id} value={bridge.id}>
                {bridge.name}
              </option>
            ))}
          </select>
          <button className="button primary" disabled={sharing || !bridgeSelection} onClick={() => void updateSharedBridge(bridgeSelection)}>
            <Server /> {sharing ? "Checking..." : sharedBridge ? "Update shared Bridge" : "Enable for testers"}
          </button>
          {sharedBridge && (
            <button className="button ghost" disabled={sharing} onClick={() => void updateSharedBridge(null)}>
              Stop sharing
            </button>
          )}
        </div>
        <small>Before enabling, set a 32+ character HAO_BRIDGE_ADMIN_TOKEN and expose the Bridge through an HTTPS endpoint with HAO_WEB_ORIGIN set to the production HAO URL.</small>
      </section>
      <section className="admin-card feedback-inbox">
        <div className="section-head"><div><span className="eyebrow">TESTER FEEDBACK</span><h2>Feedback inbox</h2></div><MessageSquareWarning/></div>
        {feedback.length ? <div className="feedback-inbox-list">{feedback.map((item, index) => {
          const metadata = item.metadata ?? {};
          const category = textValue(metadata.category) || (item.action === "source.report" ? "Source issue" : "Feedback");
          const detail = textValue(metadata.message) || textValue(metadata.detail) || "No details supplied";
          const context = textValue(metadata.pageUrl) || [textValue(metadata.title), textValue(metadata.sourceName)].filter(Boolean).join(" · ");
          const createdAt = item.created_at ?? item.at;
          return <article key={item.id ?? `${item.action}:${index}`}><span>{category}</span><div><b>{detail}</b>{context && <small>{context}</small>}</div><time>{createdAt ? new Date(createdAt).toLocaleString() : "Recently"}</time></article>;
        })}</div> : <div className="table-empty">No tester feedback yet.</div>}
      </section>
      <div className="admin-grid">
        <section className="admin-card">
          <div className="section-head">
            <div>
              <span className="eyebrow">ACCESS CONTROL</span>
              <h2>Invitations</h2>
            </div>
          </div>
          <form className="repo-form" onSubmit={invite}>
            <input aria-label="New member email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new-member@example.com" />
            <button className="button primary" disabled={busy}>
              <Link2 /> {busy ? "Creating..." : "Create tester login"}
            </button>
          </form>
          {message && <p role="status">{message}</p>}
          {created && (
            <div className="invite-result">
              <b>Temporary password for {created.email}</b>
              <p>Send this password privately. The tester must replace it the first time they sign in.</p>
              <div className="invite-copy-row">
                <input aria-label={`Temporary password for ${created.email}`} readOnly value={created.temporaryPassword} onFocus={(event) => event.currentTarget.select()} />
                <button className="button ghost" type="button" onClick={copyInvite}>
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
          <div>
            {data?.invitations?.length ? (
              data.invitations.map((item) => (
                <div className="health-row" key={item.id}>
                  <span className={item.accepted_at ? "health-dot good" : "health-dot"} />
                  <b>{item.email}</b>
                  <span>{item.accepted_at ? "accepted" : "pending"}</span>
                </div>
              ))
            ) : (
              <div className="table-empty">No pending invitations.</div>
            )}
          </div>
        </section>
        <section className="admin-card">
          <span className="eyebrow">PROVIDER STATUS</span>
          <h2>Source health</h2>
          {(data?.providers ?? []).map((item) => (
            <div className="health-row" key={item.name}>
              <span className={item.health === "operational" ? "health-dot good" : "health-dot"} />
              <b>{item.name}</b>
              <span>{item.health}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}
