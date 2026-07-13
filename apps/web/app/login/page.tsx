"use client";
import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { getSupabaseBrowser } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) return setMessage("Supabase authentication is not configured yet.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setBusy(false);
    setMessage(error ? error.message : "Check your email for your HAO sign-in link.");
  }
  return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><span className="eyebrow">INVITE-ONLY BETA</span><h1>Welcome to HAO</h1><p>Use the email address that received your invitation.</p><form onSubmit={submit}><label>Email address<input required type="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="you@example.com"/></label><button className="button primary" disabled={busy}><Mail/>{busy ? "Sending…" : "Email me a sign-in link"}</button></form>{message && <p role="status">{message}</p>}</section></div>;
}
