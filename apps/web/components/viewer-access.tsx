"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { LogIn, UserPlus } from "lucide-react";
import { authHref } from "../lib/access";

export const ViewerAccess = createContext({ signedIn: false });
export const useViewerAccess = () => useContext(ViewerAccess);

export function SignInGate({ destination, compact = false }: { destination: string; compact?: boolean }) {
  return <section className={`signin-gate${compact ? " compact" : ""}`}>
    <span className="eyebrow">JOIN THE HAO BETA</span>
    <h2>Make yourself at home.</h2>
    <p>Browse freely. Sign in to watch, read, and keep your progress across devices. Have an invite code? Create your free account.</p>
    <div className="hero-actions">
      <Link className="button primary" href={authHref("signup", destination)}><UserPlus />Create account</Link>
      <Link className="button ghost" href={authHref("login", destination)}><LogIn />Sign in</Link>
    </div>
  </section>;
}
