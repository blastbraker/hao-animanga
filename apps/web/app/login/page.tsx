"use client";
import { useState, type FormEvent } from "react";
import { KeyRound, Mail } from "lucide-react";
import { api } from "../../lib/api";
import { getSupabaseBrowser } from "../../lib/supabase";
import { safeNextDestination } from "../../lib/auth-redirect";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) return setMessage("Supabase authentication is not configured yet.");
    setBusy(true); setMessage("");
    const next = safeNextDestination(new URLSearchParams(window.location.search).get("next"));
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) { setBusy(false); setMessage(error?.message ?? "Email or password is incorrect."); return; }
    if (data.user.app_metadata?.must_change_password === true) {
      window.location.replace(`/auth/set-password?next=${encodeURIComponent(next)}`);
      return;
    }
    try {
      await api("/session");
      window.location.replace(next);
    } catch (cause) {
      await supabase.auth.signOut({ scope: "local" });
      setBusy(false); setMessage(cause instanceof Error ? cause.message : "This account is not eligible for the HAO beta.");
    }
  }
  async function recoverPassword() {
    const supabase = getSupabaseBrowser();
    if (!supabase || !email.trim()) return setMessage("Enter your invited email address first.");
    setBusy(true); setMessage("");
    const callback = new URL("/auth/callback", window.location.origin); callback.searchParams.set("flow", "recovery");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.toString() });
    setBusy(false); setMessage(error ? error.message : "Check your email for a secure password-reset link.");
  }
  return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><span className="eyebrow">INVITE-ONLY BETA</span><h1>Welcome back</h1><p>Sign in with the email and password supplied for your HAO account.</p><form onSubmit={submit}><label>Email address<input required autoComplete="email" type="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="you@example.com"/></label><label>Password<input required minLength={8} autoComplete="current-password" type="password" value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="Your password"/></label><button className="button primary" disabled={busy}><KeyRound/>{busy ? "Signing in…" : "Sign in"}</button><button className="login-link-button" type="button" disabled={busy} onClick={() => void recoverPassword()}><Mail/>Forgot your password?</button></form>{message && <p role="status">{message}</p>}</section></div>;
}
