-- Clipei Live Games: armazenamento do servidor do jogo.
-- Uma linha por conta ("channel:<id>") e uma para a conta do bot ("bot").
-- Só o servidor acessa, com a chave secreta: RLS ligado e nenhuma política
-- pública, então as chaves publicáveis (anon) não leem nem gravam nada.

create table if not exists public.clipei_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.clipei_kv enable row level security;

create or replace function public.clipei_kv_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clipei_kv_touch on public.clipei_kv;
create trigger clipei_kv_touch
  before update on public.clipei_kv
  for each row execute function public.clipei_kv_touch();

-- consultas do painel admin no futuro (assinantes, fundadores)
create index if not exists clipei_kv_channels_sub on public.clipei_kv ((value -> 'subscription' ->> 'periodEnd')) where key like 'channel:%';
