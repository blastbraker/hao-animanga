"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { BookOpen, Compass, Home, Library, Search, Settings, ShieldCheck } from "lucide-react";
import { API_URL, api } from "../lib/api";
import { getSupabaseBrowser, hasSupabaseBrowserConfig } from "../lib/supabase";

const nav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/library", label: "Library", icon: Library },
  { href: "/reader", label: "Reader", icon: BookOpen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const supabase = getSupabaseBrowser();
  const [user, setUser] = useState<User | null | undefined>(supabase ? undefined : null);
  const [role, setRole] = useState<"member" | "admin" | null | undefined>(supabase ? undefined : "admin");
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const synchronize = async (nextUser: User | null) => {
      if (cancelled) return;
      setUser(nextUser); setAuthError("");
      if (!nextUser) { setRole(null); return; }
      setRole(undefined);
      try {
        const session = await api<{ user: { role: "member" | "admin" } }>("/session");
        if (!cancelled) setRole(session.user.role);
      } catch (cause) {
        if (!cancelled) { setRole(null); setAuthError(cause instanceof Error ? cause.message : "Your session could not be verified."); }
      }
    };
    void supabase.auth.getUser().then(({ data }) => synchronize(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { void synchronize(session?.user ?? null); });
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, [supabase]);
  useEffect(() => {
    if (supabase && user === null && path !== "/login" && !path.startsWith("/auth/")) {
      window.location.replace(`/login?next=${encodeURIComponent(`${path}${window.location.search}`)}`);
    }
  }, [path, supabase, user]);
  if (path === "/login" || path.startsWith("/auth/")) return <>{children}</>;
  if (process.env.NODE_ENV === "production" && (!hasSupabaseBrowserConfig() || !API_URL)) return <DeploymentConfigurationError/>;
  if (supabase && (user === undefined || (user && role === undefined))) return <div className="login-page"><span>Loading HAO…</span></div>;
  if (supabase && !user) return <div className="login-page"><span>Redirecting to sign in…</span></div>;
  if (authError) return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><h1>Session unavailable</h1><p>{authError}</p><button className="button primary" onClick={()=>window.location.reload()}>Try again</button></section></div>;
  if (path.startsWith("/admin") && role !== "admin") return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><h1>Administrator access required</h1><p>This account cannot open HAO’s operational console.</p><Link className="button primary" href="/">Return home</Link></section></div>;
  const label = user?.email?.split("@")[0] ?? "Ali";
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Primary navigation">
      <Link href="/" className="brand" aria-label="HAO home"><img className="brand-mark" src="/brand/hao-logo-64.png" alt=""/><span>HAO</span></Link>
      <nav>{nav.map(({ href, label: itemLabel, icon: Icon }) => <Link key={href} href={href} className={path === href ? "active" : ""}><Icon size={20}/><span>{itemLabel}</span></Link>)}</nav>
      <div className="side-bottom">
        {role === "admin" && <Link href="/admin" className={path.startsWith("/admin") ? "active" : ""}><ShieldCheck size={20}/><span>Admin</span></Link>}
        <Link href="/settings" className={path === "/settings" ? "active" : ""}><Settings size={20}/><span>Settings</span></Link>
        <button className="profile-mini" onClick={()=>{if (supabase) void supabase.auth.signOut().then(()=>window.location.replace("/login"));}}><span className="avatar">{label.slice(0,2).toUpperCase()}</span><span><b>{label}</b><small>{supabase ? "Sign out" : "Beta member"}</small></span></button>
      </div>
    </aside>
    <header className="topbar">
      <Link href="/" className="mobile-brand"><img className="brand-mark" src="/brand/hao-logo-64.png" alt=""/> HAO</Link>
      <Link href="/discover" className="search-pill"><Search size={18}/><span>Search your archive...</span><kbd>Ctrl K</kbd></Link>
      <span className="beta-pill">INVITE BETA</span>
    </header>
    <main>{children}</main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({ href, label: itemLabel, icon: Icon }) => <Link key={href} href={href} className={path === href ? "active" : ""}><Icon size={20}/><span>{itemLabel}</span></Link>)}</nav>
  </div>;
}

function DeploymentConfigurationError() {
  return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><h1>Deployment incomplete</h1><p>HAO authentication or its API URL is missing. An administrator must finish the production environment configuration before invitations can be used.</p></section></div>;
}
