// Fixed, versioned DDL (SPEC §7). Never built from model or user text. CREATE only: no DROP, no ALTER on
// objects we didn't create, no reads of user tables.

export const BOOKINGS_TEMPLATE = "bookings_v1";

export const BOOKINGS_V1 = `
create table if not exists public.bookings (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 100),
  contact     text not null check (char_length(contact) between 3 and 200),
  service     text not null check (char_length(service) between 1 and 100),
  starts_at   timestamptz not null unique,
  created_at  timestamptz not null default now()
);
alter table public.bookings enable row level security;
comment on table public.bookings is 'Created by Kitpier (template bookings_v1). Synthetic demo data only.';
`;
