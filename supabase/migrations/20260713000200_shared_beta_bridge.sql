-- One admin-operated Bridge may be made available to invited beta members.
-- Members receive only its public endpoint through the authenticated HAO API;
-- ownership, pairing identity, and repository mutation remain with the admin.
alter table bridge_devices
  add column shared_beta boolean not null default false,
  add column shared_by uuid references profiles(id) on delete set null,
  add column shared_at timestamptz;

create index bridge_devices_shared_beta_idx
  on bridge_devices(shared_beta, revoked_at)
  where shared_beta = true;
