"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { api } from "../../lib/api";
import { getSupabaseBrowser } from "../../lib/supabase";
import { safeNextDestination } from "../../lib/auth-redirect";
import { authHref } from "../../lib/access";
import { passwordValidation } from "../../lib/auth-password";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [next, setNext] = useState("/");
  useEffect(() => setNext(safeNextDestination(new URLSearchParams(window.location.search).get("next"))), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = passwordValidation(password, confirmation);
    if (validation) return setMessage(validation);
    const supabase = getSupabaseBrowser();
    if (!supabase) return setMessage("Signup is not configured yet.");
    setBusy(true); setMessage("");
    try {
      await api("/auth/signup", { method: "POST", body: JSON.stringify({ email: email.trim(), password, inviteCode: inviteCode.trim() }) });
      setCreated(true);
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setPassword(""); setConfirmation(""); setInviteCode("");
      if (error) { setMessage("Your account was created. Please sign in with your email and password."); return; }
      await api("/session");
      window.location.replace(next);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Signup could not be completed. Please try again.");
    } finally { setBusy(false); }
  }

  return <div className="login-page"><section className="login-card">
    <Link href="/" aria-label="HAO home"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO" /></Link>
    <span className="eyebrow">INVITE-CODE BETA</span><h1>Join HAO</h1>
    <p>Your next episode, chapter, and saved place—all together. Use the invite code shared with you to join.</p>
    {!created && <form onSubmit={submit}>
      <label>Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label>Password<input required type="password" autoComplete="new-password" minLength={10} maxLength={128} aria-describedby="password-help" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <small id="password-help">At least 10 characters, with uppercase, lowercase, and a number.</small>
      <label>Confirm password<input required type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
      <label>Invite code<input required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={128} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Enter your invite code" /></label>
      <button className="button primary" disabled={busy}><UserPlus />{busy ? "Creating your account…" : "Create account"}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <p className="auth-switch">Already have an account? <Link href={authHref("login", next)}>Sign in</Link></p>
    <Link className="login-link-button" href="/">Keep browsing</Link>
  </section></div>;
}
