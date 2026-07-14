import type { EmailOtpType } from "@supabase/supabase-js";

const supportedEmailOtpTypes = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email"
]);

export function supportedEmailOtpType(value: string | null): EmailOtpType | null {
  return value && supportedEmailOtpTypes.has(value) ? value : null;
}
