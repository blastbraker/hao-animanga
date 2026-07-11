import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
  return client;
}

export async function inviteUser(email: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase administration is not configured");
  const redirectTo = `${process.env.WEB_ORIGIN?.split(",")[0] ?? "http://localhost:3000"}/auth/callback`;
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { invited: true },
  });
  if (error) throw error;
  if (!data.user?.id) throw new Error("Supabase did not return an invited user");
  return data.user.id;
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
