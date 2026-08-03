"use client";
import { useEffect } from "react";
import { syncCloudReadingStates } from "../lib/cloud-reading";
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") void navigator.serviceWorker.register("/sw.js");
    const sync = () => void syncCloudReadingStates();
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);
  return null;
}
