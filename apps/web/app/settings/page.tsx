"use client";

import { useEffect, useState } from "react";
import { BookOpen, Check, Cloud, Film, HardDrive, Link2, Plus, Server, ShieldAlert } from "lucide-react";
import { api } from "../../lib/api";

const DISCLAIMER = "Third-party repositories and extensions are not created, reviewed, hosted, endorsed, supported, or controlled by HAO. Their developers and content providers are unaffiliated with HAO. Availability, safety, and legality are not guaranteed. You are responsible for using only content you are authorized to access and for complying with applicable laws and provider terms.";

type BridgeDevice = { id: string; name: string; endpoint: string; lastSeenAt: string | null; revokedAt: string | null };
type SavedRepository = { id: string; bridgeId: string; mediaKind: "ANIME" | "MANGA"; url: string; name: string; acknowledgedAt: string; enabled: boolean };
type ExtensionPackage = { name: string; pkg: string; apk: string; version: string; language?: string; nsfw?: number };
type RepositoryPreview = { name: string; url: string; mediaKind: "ANIME" | "MANGA"; packages: ExtensionPackage[]; warnings: string[] };

export default function SettingsPage() {
  const [bridgeEndpoint, setBridgeEndpoint] = useState("http://127.0.0.1:4568");
  const [deviceName, setDeviceName] = useState("My HAO Bridge");
  const [bridges, setBridges] = useState<BridgeDevice[]>([]);
  const [repositories, setRepositories] = useState<SavedRepository[]>([]);
  const [repo, setRepo] = useState("https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json");
  const [mediaKind, setMediaKind] = useState<"ANIME" | "MANGA">("ANIME");
  const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState<RepositoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeBridge = bridges.find((bridge) => !bridge.revokedAt) ?? null;

  async function load() {
    const [bridgeResult, repositoryResult] = await Promise.all([
      api<{ items: BridgeDevice[] }>("/bridges"),
      api<{ items: SavedRepository[] }>("/repositories"),
    ]);
    setBridges(bridgeResult.items);
    setRepositories(repositoryResult.items);
    if (bridgeResult.items[0]?.endpoint) setBridgeEndpoint(bridgeResult.items[0].endpoint);
  }

  useEffect(() => { void load().catch((error: Error) => setMessage(error.message)); }, []);

  async function bridgeRequest<T>(path: string, body?: unknown): Promise<T> {
    const endpoint = bridgeEndpoint.replace(/\/$/, "");
    const response = await fetch(`${endpoint}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
    if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
    return payload as T;
  }

  async function pair() {
    setBusy(true); setMessage("Contacting HAO Bridge…");
    try {
      await bridgeRequest("/health");
      const pairing = await api<{ code: string; userId: string }>("/bridges/pairing-code", { method: "POST" });
      const paired = await bridgeRequest<{ deviceId: string; publicKey: string }>("/v1/pair", { code: pairing.code, accountId: pairing.userId, deviceName });
      await api("/bridges/complete", { method: "POST", body: JSON.stringify({ code: pairing.code, deviceId: paired.deviceId, publicKey: paired.publicKey, name: deviceName, endpoint: bridgeEndpoint }) });
      await load();
      setMessage("Bridge paired. Repository validation is ready.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bridge pairing failed"); }
    finally { setBusy(false); }
  }

  async function validateAndAdd() {
    if (!activeBridge) return setMessage("Pair HAO Bridge before adding a repository.");
    setBusy(true); setPreview(null); setMessage("Validating repository through your Bridge…");
    try {
      const result = await bridgeRequest<RepositoryPreview>("/v1/repositories/preview", { url: repo, mediaKind, acknowledged: ack });
      setPreview(result);
      await api("/repositories", { method: "POST", body: JSON.stringify({ bridgeId: activeBridge.id, mediaKind, url: repo, name: result.name, acknowledged: ack }) });
      await load();
      setMessage(`Enabled ${result.name} with ${result.packages.length} compatible packages.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Repository validation failed"); }
    finally { setBusy(false); }
  }

  return <div className="page inner-page settings-page">
    <div className="page-intro"><span className="eyebrow">MAKE HAO YOURS</span><h1>Sources & devices</h1><p>Your library stays independent. Sources can change without taking your history with them.</p></div>
    <section className="settings-section"><h2>Content connections</h2><div className="settings-grid"><Source icon={<Film/>} title="Jellyfin" copy="Stream from your personal media server." action="Connect"/><Source icon={<Link2/>} title="Direct media" copy="Add an authorized HTTPS HLS or MP4 URL." action="Add URL"/><Source icon={<BookOpen/>} title="EPUB library" copy="Upload books to your private encrypted storage." action="Upload"/><Source icon={<Cloud/>} title="AniList" copy="Catalog metadata and discovery." action="Active" active/></div></section>

    <section className="settings-section bridge-panel"><div><span className="eyebrow">USER-OWNED RUNTIME</span><h2>HAO Bridge Desktop</h2><p>Run manga and anime extensions on a device you control. Third-party APKs never execute in HAO’s cloud.</p><div className="repo-form"><input aria-label="Bridge endpoint" value={bridgeEndpoint} onChange={(event)=>setBridgeEndpoint(event.target.value)} placeholder="https://bridge.example.com"/><input aria-label="Bridge device name" value={deviceName} onChange={(event)=>setDeviceName(event.target.value)} placeholder="My HAO Bridge"/></div><button className="button primary" disabled={busy} onClick={()=>void pair()}><Server/>{activeBridge ? "Pair again" : "Pair Bridge"}</button></div><div className="bridge-visual"><HardDrive/><span>{activeBridge ? activeBridge.name : "Bridge offline"}</span><small>{activeBridge ? activeBridge.endpoint : "Windows · macOS · Linux"}</small></div></section>

    <section className="settings-section"><span className="eyebrow">EXTENSION REPOSITORIES</span><h2>Add repository</h2><div className="repo-form"><input type="url" value={repo} onChange={(event)=>setRepo(event.target.value)} placeholder="https://…/index.min.json"/><select aria-label="Repository type" value={mediaKind} onChange={(event)=>setMediaKind(event.target.value as "ANIME" | "MANGA")}><option value="MANGA">Manga · Mihon</option><option value="ANIME">Anime · Aniyomi</option></select></div><div className="warning-box"><ShieldAlert/><div><b>Before you continue</b><p>{DISCLAIMER}</p><label><input type="checkbox" checked={ack} onChange={(event)=>setAck(event.target.checked)}/><span>I understand and accept responsibility for this repository.</span></label></div></div><button className="button primary" disabled={busy || !activeBridge || !ack || !repo.startsWith("https://")} onClick={()=>void validateAndAdd()}><Plus/>{busy ? "Working…" : "Validate and add"}</button>{message && <p role="status">{message}</p>}
      {preview && <div className="admin-card"><h3>{preview.name}</h3><p>{preview.packages.length} compatible packages found.</p>{preview.packages.slice(0,10).map((item)=><div className="health-row" key={item.pkg}><span className="health-dot good"/><b>{item.name}</b><span>{item.version}{item.language ? ` · ${item.language}` : ""}</span></div>)}</div>}
      {repositories.length > 0 && <div className="admin-card"><h3>Enabled repositories</h3>{repositories.map((item)=><div className="health-row" key={item.id}><span className={item.enabled ? "health-dot good" : "health-dot"}/><b>{item.name}</b><span>{item.mediaKind.toLowerCase()}</span></div>)}</div>}
    </section>
  </div>;
}

function Source({ icon, title, copy, action, active }: { icon: React.ReactNode; title: string; copy: string; action: string; active?: boolean }) { return <article className="source-card"><span className="source-icon">{icon}</span><div><h3>{title}</h3><p>{copy}</p></div><button className={active ? "connected" : ""}>{active ? <Check/> : <Plus/>}{action}</button></article>; }
