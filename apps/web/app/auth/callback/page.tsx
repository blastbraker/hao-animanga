"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "../../../lib/supabase";
import { api } from "../../../lib/api";
import { safeNextDestination } from "../../../lib/auth-redirect";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing sign in…");
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const authError = url.searchParams.get("error_description");
    const next = safeNextDestination(url.searchParams.get("next"));
    if (!supabase || authError) { setMessage(authError ?? "This sign-in link is invalid or expired."); return; }
    void (async () => {
      const result = code ? await supabase.auth.exchangeCodeForSession(code) : await supabase.auth.getSession();
      if (result.error || !result.data.session) { setMessage(result.error?.message ?? "This sign-in link is invalid or expired."); return; }
      try {
        await api("/session");
        window.location.replace(next);
      } catch (cause) {
        await supabase.auth.signOut();
        setMessage(cause instanceof Error ? cause.message : "This account is not eligible for the HAO beta.");
      }
    })();
  }, []);
  return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><h1>{message}</h1></section></div>;
}
