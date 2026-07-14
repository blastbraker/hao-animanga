import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
  return client;
}

export type GeneratedInvite = {
  userId: string;
  inviteUrl: string;
};

export function buildInviteCallbackUrl(origin: string, tokenHash: string): string {
  const url = new URL("/auth/callback", `${origin.replace(/\/$/, "")}/`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "invite");
  return url.toString();
}

export async function generateInviteLink(email: string): Promise<GeneratedInvite> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase administration is not configured");
  const redirectTo = `${getWebOrigin()}/auth/callback`;
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo,
      data: { invited: true },
    },
  });
  if (error) throw error;
  if (!data.user?.id || !data.properties?.hashed_token) {
    throw new Error("Supabase did not return a usable invitation link");
  }
  return {
    userId: data.user.id,
    inviteUrl: buildInviteCallbackUrl(getWebOrigin(), data.properties.hashed_token),
  };
}

export function getWebOrigin(): string {
  const configured = process.env.WEB_ORIGIN?.split(",")[0]?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export async function uploadEpub(storageKey: string, buffer: Buffer): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase storage is not configured");
  const { error } = await supabase.storage.from("epubs").upload(storageKey, buffer, {
    contentType: "application/epub+zip",
    upsert: false,
  });
  if (error) throw error;
}
