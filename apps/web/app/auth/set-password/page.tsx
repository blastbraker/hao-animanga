"use client";
import { useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../../../lib/api";
import { passwordValidation } from "../../../lib/auth-password";
import { safeNextDestination } from "../../../lib/auth-redirect";
import { getSupabaseBrowser } from "../../../lib/supabase";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("Choose a password for future HAO sign-ins.");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const supabase = getSupabaseBrowser(); if (!supabase) return; void supabase.auth.getSession().then(({ data }) => { if (!data.session) window.location.replace("/login"); }); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); const validation = passwordValidation(password, confirmation); if (validation) return setMessage(validation);
    const supabase = getSupabaseBrowser(); if (!supabase) return setMessage("Supabase authentication is not configured yet.");
    setBusy(true); setMessage("Saving your password…");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setBusy(false); setMessage(error.message); return; }
    try {
      await api("/auth/password-ready", { method: "POST" });
      await supabase.auth.refreshSession();
      const next = safeNextDestination(new URLSearchParams(window.location.search).get("next"));
      window.location.replace(next);
    } catch (cause) { setBusy(false); setMessage(cause instanceof Error ? cause.message : "Password setup could not be completed."); }
  }
  return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><span className="eyebrow">SECURE YOUR ACCOUNT</span><h1>Choose your password</h1><p>{message}</p><form onSubmit={submit}><label>New password<input required minLength={10} autoComplete="new-password" type="password" value={password} onChange={(event)=>setPassword(event.target.value)}/></label><label>Confirm password<input required minLength={10} autoComplete="new-password" type="password" value={confirmation} onChange={(event)=>setConfirmation(event.target.value)}/></label><button className="button primary" disabled={busy}><KeyRound/>{busy ? "Saving…" : "Save password"}</button></form></section></div>;
}
