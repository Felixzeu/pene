-- viral: tabelle per video e coin. Da incollare una volta in Supabase → SQL Editor → Run.
-- Le tabelle sono leggibili/scrivibili SOLO dal backend (chiave secret): nessun accesso diretto dall'app.

-- Video montati: restano qui anche dopo che il file sul server è scaduto (24 ore).
create table if not exists public.videos (
  id          text primary key,                 -- jobId del backend
  user_id     uuid not null references auth.users on delete cascade,
  project_id  text,
  title       text,
  duration    real,
  status      text not null default 'ready',    -- ready | published
  published   jsonb not null default '[]',      -- [{provider, url, at}]
  expired     boolean not null default false,   -- true = file cancellato dal server
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  expired_at  timestamptz
);
create index if not exists videos_user_idx on public.videos (user_id, created_at desc);

-- Coin: saldo per utente e registro di ogni movimento.
create table if not exists public.wallets (
  user_id    uuid primary key references auth.users on delete cascade,
  coins      integer not null default 0 check (coins >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.coin_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  delta      integer not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists coin_ledger_user_idx on public.coin_ledger (user_id, created_at desc);

alter table public.videos      enable row level security;
alter table public.wallets     enable row level security;
alter table public.coin_ledger enable row level security;

-- Crea il portafoglio al primo uso con il bonus di benvenuto; restituisce il saldo.
create or replace function public.ensure_wallet(uid uuid, bonus integer)
returns integer language plpgsql security definer set search_path = public as $$
declare c integer;
begin
  insert into wallets (user_id, coins) values (uid, bonus) on conflict (user_id) do nothing;
  if found and bonus > 0 then
    insert into coin_ledger (user_id, delta, reason) values (uid, bonus, 'Bonus di benvenuto');
  end if;
  select coins into c from wallets where user_id = uid;
  return c;
end $$;

-- Scala i coin in modo atomico; errore 'coin_insufficienti' se non bastano.
create or replace function public.spend_coins(uid uuid, amount integer, why text)
returns integer language plpgsql security definer set search_path = public as $$
declare c integer;
begin
  update wallets set coins = coins - amount, updated_at = now()
    where user_id = uid and coins >= amount
    returning coins into c;
  if not found then raise exception 'coin_insufficienti'; end if;
  insert into coin_ledger (user_id, delta, reason) values (uid, -amount, why);
  return c;
end $$;

-- Aggiunge coin (acquisti, rimborsi, regali dell'admin).
create or replace function public.add_coins(uid uuid, amount integer, why text)
returns integer language plpgsql security definer set search_path = public as $$
declare c integer;
begin
  insert into wallets (user_id, coins) values (uid, 0) on conflict (user_id) do nothing;
  update wallets set coins = coins + amount, updated_at = now() where user_id = uid returning coins into c;
  insert into coin_ledger (user_id, delta, reason) values (uid, amount, why);
  return c;
end $$;

revoke all on function public.ensure_wallet(uuid, integer) from public, anon, authenticated;
revoke all on function public.spend_coins(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.add_coins(uuid, integer, text) from public, anon, authenticated;
