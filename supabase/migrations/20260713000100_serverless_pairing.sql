-- Vercel functions are ephemeral, so one-time Bridge pairing state must live in
-- PostgreSQL rather than process memory. Only the API's server-side database
-- role can access these hashes; no Data API policy is granted.
create table bridge_pairing_codes (
  code_hash text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(code_hash) = 64)
);

create index bridge_pairing_codes_user_expiry_idx on bridge_pairing_codes(user_id, expires_at);
alter table bridge_pairing_codes enable row level security;
