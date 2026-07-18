import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Manrope } from "next/font/google";
import "./styles.css";
import "./brand.css";
import "./home.css";
import "./discover.css";
import "./title.css";
import "./auth.css";
import "./onboarding.css";
import "./admin.css";
import "./extensions.css";
import "./reader.css";
import "./player.css";
import "./ux.css";
import { AppShell } from "../components/app-shell";
import { ServiceWorker } from "../components/service-worker";

const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: { default: "HAO — Your AniManga Archive", template: "%s · HAO" },
  description: "Discover, watch, read, and remember everything in your anime and manga life.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/hao-logo-64.png", apple: "/brand/hao-logo-192.png" },
};
export const viewport: Viewport = { themeColor: "#080a12", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${display.variable} ${body.variable}`}><body><AppShell>{children}</AppShell><ServiceWorker /></body></html>;
}
