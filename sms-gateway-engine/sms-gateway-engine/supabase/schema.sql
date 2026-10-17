create table if not exists public.sms_inbox (
  id          bigint generated always as identity primary key,
  sender      text        not null,
  body        text        not null,
  sim         text,
  sent_at     timestamptz,
  received_at timestamptz not null default now()
);

alter table public.sms_inbox enable row level security;
-- Aucune policy = personne ne lit via l'API publique. L'Edge Function ecrit avec la service_role.
-- Ajoute ensuite TA policy de lecture (ex: utilisateurs authentifies / proprietaire).
