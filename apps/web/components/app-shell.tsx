"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { ProfilePreferences } from "@hao/domain";
import {
  Activity,
  BookOpen,
  BookText,
  Compass,
  Home,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { API_URL, api } from "../lib/api";
import { getSupabaseBrowser, hasSupabaseBrowserConfig } from "../lib/supabase";
import { OPEN_BETA_ONBOARDING_EVENT } from "../lib/onboarding";
import { OPEN_READER_BROWSER_EVENT } from "../lib/reader-navigation";
import { BetaOnboarding } from "./beta-onboarding";
import { GlobalSearch } from "./global-search";
import { FeedbackDialog } from "./feedback-dialog";

const nav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/library", label: "Library", icon: Library },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/reader", label: "Manga", icon: BookOpen },
  { href: "/novels", label: "Novels", icon: BookText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const supabase = getSupabaseBrowser();
  const [user, setUser] = useState<User | null | undefined>(
    supabase ? undefined : null,
  );
  const [role, setRole] = useState<"member" | "admin" | null | undefined>(
    supabase ? undefined : "admin",
  );
  const [authError, setAuthError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");
  useEffect(() => {
    try {
      setSidebarCollapsed(
        window.localStorage.getItem("hao:sidebar-collapsed") === "true",
      );
    } catch {
      /* Use the expanded navigation when storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    if (!role) return;
    void api<ProfilePreferences>("/profile").then((profile) => setProfileLabel(profile.displayName)).catch(() => undefined);
  }, [role]);
  useEffect(() => {
    function toggleFromKeyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "b" ||
        (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      )
        return;
      event.preventDefault();
      setSidebarCollapsed((value) => {
        const next = !value;
        try {
          window.localStorage.setItem("hao:sidebar-collapsed", String(next));
        } catch {
          /* The toggle still works for this session. */
        }
        return next;
      });
    }
    window.addEventListener("keydown", toggleFromKeyboard);
    return () => window.removeEventListener("keydown", toggleFromKeyboard);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const scheduled = new Set<number>();
    const synchronize = async (nextUser: User | null) => {
      if (cancelled) return;
      setUser(nextUser);
      setAuthError("");
      if (!nextUser) {
        setRole(null);
        return;
      }
      if (nextUser.app_metadata?.must_change_password === true) {
        setRole(null);
        return;
      }
      setRole(undefined);
      try {
        const session = await api<{ user: { role: "member" | "admin" } }>(
          "/session",
        );
        if (!cancelled) {
          setRole(session.user.role);
          window.localStorage.setItem("hao:session-role", session.user.role);
        }
      } catch (cause) {
        if (!cancelled) {
          if (!navigator.onLine) {
            const cachedRole = window.localStorage.getItem("hao:session-role");
            setRole(cachedRole === "admin" ? "admin" : "member");
            setAuthError("");
          } else {
            setRole(null);
            setAuthError(
              cause instanceof Error
                ? cause.message
                : "Your session could not be verified.",
            );
          }
        }
      }
    };
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        return synchronize(data.session?.user ?? null);
      })
      .catch((cause) => {
        if (!cancelled) {
          setUser(null);
          setRole(null);
          setAuthError(
            cause instanceof Error
              ? cause.message
              : "Your session could not be verified.",
          );
        }
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const timeout = window.setTimeout(() => {
        scheduled.delete(timeout);
        void synchronize(session?.user ?? null);
      }, 0);
      scheduled.add(timeout);
    });
    return () => {
      cancelled = true;
      for (const timeout of scheduled) window.clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, [supabase]);
  useEffect(() => {
    if (
      supabase &&
      user === null &&
      path !== "/login" &&
      !path.startsWith("/auth/")
    ) {
      window.location.replace(
        `/login?next=${encodeURIComponent(`${path}${window.location.search}`)}`,
      );
    }
  }, [path, supabase, user]);
  useEffect(() => {
    if (
      supabase &&
      user?.app_metadata?.must_change_password === true &&
      !path.startsWith("/auth/")
    ) {
      window.location.replace(
        `/auth/set-password?next=${encodeURIComponent(`${path}${window.location.search}`)}`,
      );
    }
  }, [path, supabase, user]);
  if (path === "/login" || path.startsWith("/auth/")) return <>{children}</>;
  if (
    process.env.NODE_ENV === "production" &&
    (!hasSupabaseBrowserConfig() || !API_URL)
  )
    return <DeploymentConfigurationError />;
  if (supabase && (user === undefined || (user && role === undefined)))
    return (
      <div className="login-page">
        <span>Loading HAO…</span>
      </div>
    );
  if (supabase && !user)
    return (
      <div className="login-page">
        <span>Redirecting to sign in…</span>
      </div>
    );
  if (supabase && user?.app_metadata?.must_change_password === true)
    return (
      <div className="login-page">
        <span>Redirecting to password setup…</span>
      </div>
    );
  if (authError)
    return (
      <div className="login-page">
        <section className="login-card">
          <img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO" />
          <h1>Session unavailable</h1>
          <p>{authError}</p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </section>
      </div>
    );
  if (path.startsWith("/admin") && role !== "admin")
    return (
      <div className="login-page">
        <section className="login-card">
          <img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO" />
          <h1>Administrator access required</h1>
          <p>This account cannot open HAO’s operational console.</p>
          <Link className="button primary" href="/">
            Return home
          </Link>
        </section>
      </div>
    );
  const label = profileLabel || user?.email?.split("@")[0] || "Ali";
  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("hao:sidebar-collapsed", String(next));
      } catch {
        /* The toggle still works for this session. */
      }
      return next;
    });
  }
  function handleNavigation(href: string) {
    if (href === "/reader" && path === "/reader")
      window.dispatchEvent(new Event(OPEN_READER_BROWSER_EVENT));
  }
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-header">
          <Link href="/" className="brand" aria-label="HAO home">
            <img className="brand-mark" src="/brand/hao-logo-64.png" alt="" />
            <span>HAO</span>
          </Link>
          <button
            className="sidebar-toggle"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            aria-expanded={!sidebarCollapsed}
            title={`${sidebarCollapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <nav>
          {nav.map(({ href, label: itemLabel, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={
                path === href || (href !== "/" && path.startsWith(`${href}/`))
                  ? "active"
                  : ""
              }
              title={sidebarCollapsed ? itemLabel : undefined}
              onClick={() => handleNavigation(href)}
            >
              <Icon size={20} />
              <span>{itemLabel}</span>
            </Link>
          ))}
        </nav>
        <div className="side-bottom">
          {role === "admin" && (
            <Link
              href="/admin"
              className={path.startsWith("/admin") ? "active" : ""}
              title={sidebarCollapsed ? "Admin" : undefined}
            >
              <ShieldCheck size={20} />
              <span>Admin</span>
            </Link>
          )}
          <Link
            href="/settings"
            className={path === "/settings" ? "active" : ""}
            title={sidebarCollapsed ? "Settings" : undefined}
          >
            <Settings size={20} />
            <span>Settings</span>
          </Link>
          <button
            className="profile-mini"
            title={
              sidebarCollapsed
                ? supabase
                  ? `Sign out ${label}`
                  : label
                : undefined
            }
            aria-label={
              supabase ? `Sign out ${label}` : `${label}, beta member`
            }
            onClick={() => {
              if (supabase)
                void supabase.auth
                  .signOut()
                  .then(() => window.location.replace("/login"));
            }}
          >
            <span className="avatar">{label.slice(0, 2).toUpperCase()}</span>
            <span>
              <b>{label}</b>
              <small>{supabase ? "Sign out" : "Beta member"}</small>
            </span>
          </button>
        </div>
      </aside>
      <header className="topbar">
        <Link href="/" className="mobile-brand">
          <img className="brand-mark" src="/brand/hao-logo-64.png" alt="" /> HAO
        </Link>
        <GlobalSearch />
        <button
          className="beta-pill"
          onClick={() =>
            window.dispatchEvent(new Event(OPEN_BETA_ONBOARDING_EVENT))
          }
        >
          BETA GUIDE
        </button>
      </header>
      <main>{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map(({ href, label: itemLabel, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={
              path === href || (href !== "/" && path.startsWith(`${href}/`))
                ? "active"
                : ""
            }
            onClick={() => handleNavigation(href)}
          >
            <Icon size={20} />
            <span>{itemLabel}</span>
          </Link>
        ))}
      </nav>
      <BetaOnboarding autoOpen={role === "member"} />
      <FeedbackDialog />
    </div>
  );
}

function DeploymentConfigurationError() {
  return (
    <div className="login-page">
      <section className="login-card">
        <img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO" />
        <h1>Deployment incomplete</h1>
        <p>
          HAO authentication or its API URL is missing. An administrator must
          finish the production environment configuration before invitations can
          be used.
        </p>
      </section>
    </div>
  );
}
