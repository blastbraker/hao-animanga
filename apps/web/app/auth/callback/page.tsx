"use client";
import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "../../../lib/supabase";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing sign in…");
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const code = new URL(window.location.href).searchParams.get("code");
    if (!supabase || !code) { setMessage("This sign-in link is invalid or expired."); return; }
    void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setMessage(error.message);
      else window.location.replace("/");
    });
  }, []);
  return <div className="login-page"><section className="login-card"><img className="brand-mark" src="/brand/hao-logo-64.png" alt="HAO"/><h1>{message}</h1></section></div>;
}
