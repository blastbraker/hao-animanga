"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Cloud, Download, Film, HardDrive, Link2, Plus, Power, RefreshCw, Search, Server, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../../lib/api";

const DISCLAIMER = "Third-party repositories and extensions are not created, reviewed, hosted, endorsed, supported, or controlled by HAO. Their developers and content providers are unaffiliated with HAO. Availability, safety, and legality are not guaranteed. You are responsible for using only content you are authorized to access and for complying with applicable laws and provider terms.";

type MediaKind = "ANIME" | "MANGA";
type BridgeDevice = { id: string; name: string; endpoint: string; lastSeenAt: string | null; revokedAt: string | null };
type SavedRepository = { id: string; bridgeId: string; mediaKind: MediaKind; url: string; name: string; acknowledgedAt: string; enabled: boolean };
type ExtensionPackage = { name: string; pkg: string; apk: string; version: string; language?: string; nsfw?: number };
type RepositoryPreview = { name: string; url: string; mediaKind: MediaKind; packages: ExtensionPackage[]; warnings: string[] };
type ExtensionInspection = {
  id: string;
  packageName: string;
  displayName: string;
  mediaKind: MediaKind;
  version: string;
  sha256: string;
  signerFingerprint: string;
  previousSignerFingerprint?: string;
  signerChanged: boolean;
  permissions: string[];
  previousPermissions: string[];
  permissionsChanged: boolean;
  byteSize: number;
  maturity: "GENERAL" | "MATURE" | "ADULT";
  expiresAt: string;
};
type InstalledExtension = {
  packageName: string;
  displayName: string;
  mediaKind: MediaKind;
  version: string;
  sha256: string;
  signerFingerprint: string;
  permissions: string[];
  byteSize: number;
  maturity: string;
  installedAt: string;
  enabled: boolean;
};
type MangaRuntimeStatus = { running: boolean; managed: boolean; message: string; sourceCount: number; installedExtensionCount: number };
type ExtensionSyncResult = { installed: string[]; removed: string[]; unchanged: string[]; errors: string[] };
type BridgeRuntimeStatus = { id: string; kind: MediaKind; available: boolean; message: string };

export default function SettingsPage() {
  const [bridgeEndpoint, setBridgeEndpoint] = useState("http://127.0.0.1:4568");
  const [deviceName, setDeviceName] = useState("My HAO Bridge");
  const [bridges, setBridges] = useState<BridgeDevice[]>([]);
  const [repositories, setRepositories] = useState<SavedRepository[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [mangaRuntime, setMangaRuntime] = useState<MangaRuntimeStatus | null>(null);
  const [bridgeRuntimes, setBridgeRuntimes] = useState<BridgeRuntimeStatus[]>([]);
  const [repo, setRepo] = useState("https://raw.githubusercontent.com/yuzono/anime-repo/repo/index.min.json");
  const [mediaKind, setMediaKind] = useState<MediaKind>("ANIME");
  const [acknowledged, setAcknowledged] = useState(false);
  const [preview, setPreview] = useState<RepositoryPreview | null>(null);
  const [inspection, setInspection] = useState<ExtensionInspection | null>(null);
  const [packageQuery, setPackageQuery] = useState("");
  const [maturityFilter, setMaturityFilter] = useState("GENERAL");
  const [permissionConsent, setPermissionConsent] = useState(false);
  const [signerConsent, setSignerConsent] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const activeBridge = bridges.find((bridge) => !bridge.revokedAt) ?? null;
  const normalizedRepositoryUrl = repo.trim();
  const visiblePackages = useMemo(() => {
    if (!preview) return [];
    const query = packageQuery.trim().toLowerCase();
    return preview.packages.filter((item) => {
      const maturity = packageMaturity(item);
      const maturityMatches = maturityFilter === "ALL" || maturity === maturityFilter;
      const queryMatches = !query || `${item.name} ${item.pkg} ${item.language ?? ""}`.toLowerCase().includes(query);
      return maturityMatches && queryMatches;
    }).slice(0, 50);
  }, [maturityFilter, packageQuery, preview]);

  async function loadCloudState() {
    const [bridgeResult, repositoryResult] = await Promise.all([
      api<{ items: BridgeDevice[] }>("/bridges"),
      api<{ items: SavedRepository[] }>("/repositories"),
    ]);
    setBridges(bridgeResult.items);
    setRepositories(repositoryResult.items);
    if (bridgeResult.items[0]?.endpoint) setBridgeEndpoint(bridgeResult.items[0].endpoint);
  }

  useEffect(() => { void loadCloudState().catch((error: Error) => setMessage(error.message)); }, []);
  useEffect(() => {
    if (!activeBridge?.endpoint) return;
    void Promise.all([
      requestBridgeAt<InstalledExtension[]>(activeBridge.endpoint, "/v1/extensions").then(setInstalledExtensions),
      requestBridgeAt<MangaRuntimeStatus>(activeBridge.endpoint, "/v1/manga/runtime").then(setMangaRuntime),
      requestBridgeAt<BridgeRuntimeStatus[]>(activeBridge.endpoint, "/v1/runtimes").then(setBridgeRuntimes),
    ])
      .catch((error: Error) => setMessage(`Bridge extension status unavailable: ${error.message}`));
  }, [activeBridge?.endpoint]);

  async function requestBridgeAt<T>(endpointValue: string, path: string, body?: unknown): Promise<T> {
    const endpoint = endpointValue.trim().replace(/\/$/, "");
    const init = body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const response = await fetch(`${endpoint}${path}`, init);
    const payload = await response.json().catch(() => null) as ({ message?: string } & T) | null;
    if (!response.ok) throw new Error(payload?.message ?? `Bridge returned ${response.status}`);
    return payload as T;
  }

  function bridgeRequest<T>(path: string, body?: unknown) { return requestBridgeAt<T>(bridgeEndpoint, path, body); }

  async function loadInstalled() {
    const result = await bridgeRequest<InstalledExtension[]>("/v1/extensions");
    setInstalledExtensions(result);
  }

  async function loadRuntime() {
    const result = await bridgeRequest<MangaRuntimeStatus>("/v1/manga/runtime");
    setMangaRuntime(result);
    return result;
  }

  async function startRuntime() {
    setBusyAction("runtime-start"); setMessage("Starting the local manga runtime…");
    try {
      const result = await bridgeRequest<MangaRuntimeStatus>("/v1/manga/runtime/start", {});
      setMangaRuntime(result);
      setMessage(result.running ? "Manga runtime is ready." : result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Manga runtime failed to start"); }
    finally { setBusyAction(null); }
  }

  async function syncRuntime() {
    setBusyAction("runtime-sync"); setMessage("Synchronizing reviewed manga extensions…");
    try {
      const result = await bridgeRequest<ExtensionSyncResult>("/v1/manga/runtime/sync", {});
      await loadRuntime();
      setMessage(result.errors.length ? `Synchronization finished with errors: ${result.errors.join("; ")}` : `Manga runtime synchronized. ${result.installed.length} installed, ${result.removed.length} removed, ${result.unchanged.length} unchanged.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Extension synchronization failed"); }
    finally { setBusyAction(null); }
  }

  async function pair() {
    setBusyAction("pair"); setMessage("Contacting HAO Bridge…");
    try {
      await bridgeRequest("/health");
      const pairing = await api<{ code: string; userId: string }>("/bridges/pairing-code", { method: "POST" });
      const paired = await bridgeRequest<{ deviceId: string; publicKey: string }>("/v1/pair", { code: pairing.code, accountId: pairing.userId, deviceName });
      await api("/bridges/complete", { method: "POST", body: JSON.stringify({ code: pairing.code, deviceId: paired.deviceId, publicKey: paired.publicKey, name: deviceName, endpoint: bridgeEndpoint.trim() }) });
      await loadCloudState();
      setMessage("Bridge paired. Repository validation is ready.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bridge pairing failed"); }
    finally { setBusyAction(null); }
  }

  async function previewRepository(url: string, kind: MediaKind, save: boolean) {
    if (!activeBridge) return setMessage("Pair HAO Bridge before using a repository.");
    if (!acknowledged) return setMessage("Accept the third-party repository acknowledgement first.");
    setBusyAction("repository"); setInspection(null); setMessage("Validating repository through your Bridge…");
    try {
      const result = await bridgeRequest<RepositoryPreview>("/v1/repositories/preview", { url: url.trim(), mediaKind: kind, acknowledged });
      setRepo(url.trim()); setMediaKind(kind); setPreview(result); setPackageQuery(""); setMaturityFilter("GENERAL");
      if (save) {
        await api("/repositories", { method: "POST", body: JSON.stringify({ bridgeId: activeBridge.id, mediaKind: kind, url: url.trim(), name: result.name, acknowledged }) });
        await loadCloudState();
      }
      setMessage(`${save ? "Enabled" : "Loaded"} ${result.name} with ${result.packages.length} compatible packages.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Repository validation failed"); }
    finally { setBusyAction(null); }
  }

  async function inspectPackage(item: ExtensionPackage) {
    if (!preview) return;
    setBusyAction(item.pkg); setInspection(null); setPermissionConsent(false); setSignerConsent(false);
    setMessage(`Downloading ${item.name} into the Bridge quarantine for inspection…`);
    try {
      const result = await bridgeRequest<ExtensionInspection>("/v1/extensions/inspect", {
        repositoryUrl: preview.url,
        mediaKind: preview.mediaKind,
        packageInfo: item,
        acknowledged,
      });
      setInspection(result);
      setMessage("Inspection complete. Review the signer and permissions before installation.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Extension inspection failed"); }
    finally { setBusyAction(null); }
  }

  async function installInspected() {
    if (!inspection) return;
    setBusyAction("install");
    try {
      await bridgeRequest<InstalledExtension>("/v1/extensions/install", {
        inspectionId: inspection.id,
        acknowledged,
        acceptPermissions: permissionConsent,
        acceptSignerChange: signerConsent,
      });
      await loadInstalled();
      await loadRuntime();
      setInspection(null); setPermissionConsent(false); setSignerConsent(false);
      setMessage(inspection.mediaKind === "MANGA" ? "Extension installed, verified, and synchronized to the local manga runtime." : "Extension installed locally. Anime execution remains gated by its runtime.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Extension installation failed"); }
    finally { setBusyAction(null); }
  }

  async function setExtensionEnabled(item: InstalledExtension, enabled: boolean) {
    setBusyAction(item.packageName);
    try {
      await bridgeRequest("/v1/extensions/state", { mediaKind: item.mediaKind, packageName: item.packageName, enabled });
      await loadInstalled(); await loadRuntime(); setMessage(`${item.displayName} ${enabled ? "enabled and synchronized" : "disabled and removed from its runtime"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Extension state update failed"); }
    finally { setBusyAction(null); }
  }

  async function removeExtension(item: InstalledExtension) {
    if (pendingRemoval !== item.packageName) { setPendingRemoval(item.packageName); return; }
    setBusyAction(item.packageName);
    try {
      await bridgeRequest("/v1/extensions/remove", { mediaKind: item.mediaKind, packageName: item.packageName });
      await loadInstalled(); await loadRuntime(); setPendingRemoval(null); setMessage(`${item.displayName} removed from this Bridge and its runtime.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Extension removal failed"); }
    finally { setBusyAction(null); }
  }

  return <div className="page inner-page settings-page">
    <div className="page-intro"><span className="eyebrow">MAKE HAO YOURS</span><h1>Sources & devices</h1><p>Your library stays independent. Sources can change without taking your history with them.</p></div>
    <section className="settings-section"><h2>Content connections</h2><div className="settings-grid"><Source icon={<Film/>} title="Jellyfin" copy="Stream from your personal media server." action="Connect"/><Source icon={<Link2/>} title="Direct media" copy="Add an authorized HTTPS HLS or MP4 URL." action="Add URL"/><Source icon={<BookOpen/>} title="EPUB library" copy="Upload books to your private encrypted storage." action="Upload"/><Source icon={<Cloud/>} title="AniList" copy="Catalog metadata and discovery." action="Active" active/></div></section>

    <section className="settings-section bridge-panel"><div><span className="eyebrow">USER-OWNED RUNTIME</span><h2>HAO Bridge Desktop</h2><p>Inspect and store extensions on a device you control. Third-party APKs never execute in HAO’s cloud.</p><div className="repo-form"><input aria-label="Bridge endpoint" value={bridgeEndpoint} onChange={(event)=>setBridgeEndpoint(event.target.value)} placeholder="https://bridge.example.com"/><input aria-label="Bridge device name" value={deviceName} onChange={(event)=>setDeviceName(event.target.value)} placeholder="My HAO Bridge"/></div><button className="button primary" disabled={busyAction !== null} onClick={()=>void pair()}><Server/>{activeBridge ? "Pair again" : "Pair Bridge"}</button></div><div className="bridge-visual"><HardDrive/><span>{activeBridge ? activeBridge.name : "Bridge offline"}</span><small>{activeBridge ? activeBridge.endpoint : "Windows · macOS · Linux"}</small></div></section>

    {activeBridge && <section className="settings-section admin-card runtime-control"><div className="runtime-heading"><div><span className="eyebrow">MANGA EXECUTION</span><h2>Suwayomi runtime</h2><p>{mangaRuntime?.message ?? "Checking the local manga runtime…"}</p></div><span className={mangaRuntime?.running ? "runtime-badge running" : "runtime-badge"}><i/>{mangaRuntime?.running ? "Running" : "Stopped"}</span></div><div className="runtime-stats"><span><b>{mangaRuntime?.sourceCount ?? 0}</b> sources</span><span><b>{mangaRuntime?.installedExtensionCount ?? 0}</b> synchronized extensions</span><span><b>{mangaRuntime?.managed ? "Automatic" : "External"}</b> lifecycle</span></div><div className="runtime-actions"><button className="button primary" disabled={busyAction !== null || mangaRuntime?.running === true || mangaRuntime?.managed === false} onClick={()=>void startRuntime()}><Power/>{busyAction === "runtime-start" ? "Starting…" : "Start runtime"}</button><button className="button ghost" disabled={busyAction !== null || !mangaRuntime?.running} onClick={()=>void syncRuntime()}><RefreshCw/>{busyAction === "runtime-sync" ? "Synchronizing…" : "Sync extensions"}</button></div></section>}

    {activeBridge && <section className="settings-section admin-card runtime-control"><div className="runtime-heading"><div><span className="eyebrow">ANIME EXECUTION</span><h2>Isolated anime host</h2><p>The fixture provider runs in a separate constrained JVM. Third-party Aniyomi APK loading remains disabled.</p></div><ShieldCheck/></div><div className="runtime-list">{bridgeRuntimes.filter((runtime)=>runtime.kind === "ANIME").map((runtime)=><div className="health-row" key={runtime.id}><span className={runtime.available ? "health-dot good" : "health-dot"}/><div><b>{runtime.id === "aniyomi-fixture-host" ? "Fixture compatibility host" : "Aniyomi APK compatibility"}</b><small>{runtime.message}</small></div><span>{runtime.available ? "ready" : "gated"}</span></div>)}</div></section>}

    <section className="settings-section">
      <span className="eyebrow">EXTENSION REPOSITORIES</span><h2>Add repository</h2>
      <div className="repo-form"><input type="url" value={repo} onChange={(event)=>setRepo(event.target.value)} onBlur={()=>setRepo(normalizedRepositoryUrl)} placeholder="https://…/index.min.json"/><select aria-label="Repository type" value={mediaKind} onChange={(event)=>setMediaKind(event.target.value as MediaKind)}><option value="MANGA">Manga · Mihon</option><option value="ANIME">Anime · Aniyomi</option></select></div>
      <div className="warning-box"><ShieldAlert/><div><b>Before you continue</b><p>{DISCLAIMER}</p><label><input type="checkbox" checked={acknowledged} onChange={(event)=>setAcknowledged(event.target.checked)}/><span>I understand and accept responsibility for this repository.</span></label></div></div>
      <button className="button primary" disabled={busyAction !== null || !activeBridge || !acknowledged || !normalizedRepositoryUrl.startsWith("https://")} onClick={()=>void previewRepository(normalizedRepositoryUrl, mediaKind, true)}><Plus/>{busyAction === "repository" ? "Working…" : "Validate and add"}</button>
      {message && <p role="status" className="settings-status">{message}</p>}

      {repositories.length > 0 && <div className="admin-card repository-list"><h3>Enabled repositories</h3>{repositories.map((item)=><div className="health-row" key={item.id}><span className={item.enabled ? "health-dot good" : "health-dot"}/><div><b>{item.name}</b><small>{item.mediaKind.toLowerCase()} · {item.url}</small></div><button className="button ghost compact" disabled={!acknowledged || busyAction !== null} onClick={()=>void previewRepository(item.url, item.mediaKind, false)}>Browse</button></div>)}</div>}

      {preview && <div className="admin-card extension-browser">
        <div className="extension-heading"><div><h3>{preview.name}</h3><p>{preview.packages.length} compatible packages. Mature packages are hidden by default.</p></div><span>{preview.mediaKind.toLowerCase()}</span></div>
        <div className="extension-toolbar"><label><Search/><input aria-label="Search extension packages" value={packageQuery} onChange={(event)=>setPackageQuery(event.target.value)} placeholder="Search packages or languages"/></label><select aria-label="Maturity filter" value={maturityFilter} onChange={(event)=>setMaturityFilter(event.target.value)}><option value="GENERAL">General only</option><option value="MATURE">Mature only</option><option value="ADULT">Adult only</option><option value="ALL">All maturity levels</option></select></div>
        <div className="extension-list">{visiblePackages.map((item)=><div className="extension-row" key={item.pkg}><div><b>{item.name}</b><small>{item.pkg}</small></div><div className="extension-meta"><span>{item.version}</span><span>{item.language ?? "unknown"}</span><span className={`maturity ${packageMaturity(item).toLowerCase()}`}>{packageMaturity(item).toLowerCase()}</span></div><button className="button ghost compact" disabled={busyAction !== null} onClick={()=>void inspectPackage(item)}><Download/>{busyAction === item.pkg ? "Inspecting…" : "Review"}</button></div>)}</div>
        {visiblePackages.length === 0 && <p className="extension-empty">No packages match these filters.</p>}
      </div>}

      {inspection && <div className="admin-card inspection-card">
        <div className="inspection-title"><ShieldCheck/><div><h3>Review {inspection.displayName}</h3><p>{formatBytes(inspection.byteSize)} · version {inspection.version} · {inspection.maturity.toLowerCase()}</p></div></div>
        {inspection.signerChanged && <div className="signer-warning"><ShieldAlert/><div><b>Signing identity changed</b><p>The new signer does not match the installed version. Install only if the repository maintainer announced this change.</p></div></div>}
        {inspection.permissionsChanged && <div className="signer-warning"><ShieldAlert/><div><b>Declared permissions changed</b><p>Review the complete list again. Newly declared permissions are highlighted below.</p></div></div>}
        <dl className="inspection-facts"><div><dt>SHA-256</dt><dd><code>{inspection.sha256}</code></dd></div><div><dt>Signer fingerprint</dt><dd><code>{inspection.signerFingerprint}</code></dd></div></dl>
        <div className="permission-review"><h4>Declared Android permissions ({inspection.permissions.length})</h4>{inspection.permissions.length === 0 ? <p>No Android permissions declared.</p> : <ul>{inspection.permissions.map((permission)=><li className={isSensitivePermission(permission) || (inspection.permissionsChanged && !inspection.previousPermissions.includes(permission)) ? "sensitive" : ""} key={permission}>{permission}</li>)}</ul>}</div>
        <label className="install-consent"><input type="checkbox" checked={permissionConsent} onChange={(event)=>setPermissionConsent(event.target.checked)}/><span>I reviewed and accept these permissions. Store this APK locally without executing it.</span></label>
        {inspection.signerChanged && <label className="install-consent danger"><input type="checkbox" checked={signerConsent} onChange={(event)=>setSignerConsent(event.target.checked)}/><span>I independently verified and accept the new signing identity.</span></label>}
        <button className="button primary" disabled={busyAction !== null || !permissionConsent || (inspection.signerChanged && !signerConsent)} onClick={()=>void installInspected()}><Download/>{busyAction === "install" ? "Installing…" : "Install locally"}</button>
      </div>}

      {installedExtensions.length > 0 && <div className="admin-card installed-extensions"><h3>Installed on this Bridge</h3>{installedExtensions.map((item)=><div className="extension-row" key={`${item.mediaKind}:${item.packageName}`}><div><b>{item.displayName}</b><small>{item.version} · {item.permissions.length} permissions · signer {item.signerFingerprint.slice(0,12)}…</small></div><span className={item.enabled ? "installed-state enabled" : "installed-state"}>{item.enabled ? "enabled" : "disabled"}</span><div className="extension-actions"><button className="button ghost compact" disabled={busyAction !== null} onClick={()=>void setExtensionEnabled(item,!item.enabled)}><Power/>{item.enabled ? "Disable" : "Enable"}</button><button className="button ghost compact danger" disabled={busyAction !== null} onClick={()=>void removeExtension(item)}><Trash2/>{pendingRemoval === item.packageName ? "Confirm remove" : "Remove"}</button></div></div>)}</div>}
    </section>
  </div>;
}

function Source({ icon, title, copy, action, active }: { icon: React.ReactNode; title: string; copy: string; action: string; active?: boolean }) { return <article className="source-card"><span className="source-icon">{icon}</span><div><h3>{title}</h3><p>{copy}</p></div><button className={active ? "connected" : ""}>{active ? <Check/> : <Plus/>}{action}</button></article>; }
function packageMaturity(item: ExtensionPackage) { return !item.nsfw ? "GENERAL" : item.nsfw === 1 ? "MATURE" : "ADULT"; }
function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`; }
function isSensitivePermission(permission: string) { return /(CAMERA|MICROPHONE|RECORD_AUDIO|LOCATION|CONTACTS|SMS|PHONE|CALL_LOG|INSTALL_PACKAGES|QUERY_ALL_PACKAGES|READ_MEDIA|EXTERNAL_STORAGE)/i.test(permission); }
