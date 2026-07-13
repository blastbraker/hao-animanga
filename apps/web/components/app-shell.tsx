"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { BookOpen, Compass, Home, Library, Search, Settings, ShieldCheck } from "lucide-react";
import { getSupabaseBrowser } from "../lib/supabase";

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
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);
  if (path === "/login" || path.startsWith("/auth/")) return <>{children}</>;
  if (supabase && user === undefined) return <div className="login-page"><span>Loading HAO…</span></div>;
  if (supabase && !user) { window.location.replace("/login"); return null; }
  const label = user?.email?.split("@")[0] ?? "Ali";
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Primary navigation">
      <Link href="/" className="brand" aria-label="HAO home"><img className="brand-mark" src="/brand/hao-logo-64.png" alt=""/><span>HAO</span></Link>
      <nav>{nav.map(({ href, label: itemLabel, icon: Icon }) => <Link key={href} href={href} className={path === href ? "active" : ""}><Icon size={20}/><span>{itemLabel}</span></Link>)}</nav>
      <div className="side-bottom">
        <Link href="/admin" className={path.startsWith("/admin") ? "active" : ""}><ShieldCheck size={20}/><span>Admin</span></Link>
        <Link href="/settings" className={path === "/settings" ? "active" : ""}><Settings size={20}/><span>Settings</span></Link>
        <button className="profile-mini" onClick={()=>void supabase?.auth.signOut()}><span className="avatar">{label.slice(0,2).toUpperCase()}</span><span><b>{label}</b><small>{supabase ? "Sign out" : "Beta member"}</small></span></button>
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
