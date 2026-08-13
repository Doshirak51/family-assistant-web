-- Family Assistant Web v1
-- Run this once in Supabase -> SQL Editor. It is independent from the old bot tables.
create extension if not exists pgcrypto;

create type public.family_web_role as enum ('owner', 'member');
create type public.family_web_transaction_kind as enum ('income', 'expense');

create table public.family_web_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.family_web_households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.family_web_members (
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.family_web_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

create table public.family_web_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((redeemed_at is null and redeemed_by is null) or (redeemed_at is not null and redeemed_by is not null))
);

create table public.family_web_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind public.family_web_transaction_kind not null default 'expense',
  icon text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name, kind)
);

create table public.family_web_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  kind public.family_web_transaction_kind not null,
  amount numeric(14, 2) not null check (amount > 0),
  category_id uuid references public.family_web_categories(id) on delete set null,
  note text check (char_length(note) <= 300),
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index family_web_transactions_idx on public.family_web_transactions (household_id, occurred_at desc);

create table public.family_web_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index family_web_tasks_idx on public.family_web_tasks (household_id, completed_at, due_at);

create table public.family_web_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index family_web_events_idx on public.family_web_events (household_id, starts_at);

create table public.family_web_shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.family_web_households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.family_web_shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.family_web_shopping_lists(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.family_web_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.family_web_profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1), 'Участник семьи')
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists family_web_on_auth_user_created on auth.users;
create trigger family_web_on_auth_user_created
after insert on auth.users for each row execute procedure public.family_web_handle_new_user();

create or replace function public.family_web_is_member(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_web_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

create or replace function public.family_web_is_owner(p_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_web_members
    where household_id = p_household_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.family_web_can_access_list(p_list_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_web_shopping_lists l
    join public.family_web_members m on m.household_id = l.household_id
    where l.id = p_list_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.family_web_ensure_profile()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.family_web_profiles (id, full_name)
  select id, coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), nullif(trim(raw_user_meta_data ->> 'name'), ''), split_part(email, '@', 1), 'Участник семьи')
  from auth.users where id = auth.uid()
  on conflict (id) do nothing;
end;
$$;

create or replace function public.family_web_create_household(p_name text)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare created_household_id uuid;
begin
  if auth.uid() is null then raise exception 'Нужно войти в приложение.'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Введите название семейного пространства.'; end if;
  if exists (select 1 from public.family_web_members where user_id = auth.uid()) then raise exception 'Вы уже состоите в семейном пространстве.'; end if;
  perform public.family_web_ensure_profile();
  insert into public.family_web_households (name) values (trim(p_name)) returning id into created_household_id;
  insert into public.family_web_members (household_id, user_id, role) values (created_household_id, auth.uid(), 'owner');
  insert into public.family_web_categories (household_id, name, kind, icon, position) values
    (created_household_id, 'Продукты', 'expense', '🛒', 1), (created_household_id, 'Дом', 'expense', '🏠', 2),
    (created_household_id, 'Коты', 'expense', '🐈', 3), (created_household_id, 'Красота', 'expense', '✨', 4),
    (created_household_id, 'Транспорт', 'expense', '🚕', 5), (created_household_id, 'Кафе', 'expense', '☕', 6),
    (created_household_id, 'Здоровье', 'expense', '🩺', 7), (created_household_id, 'Путешествия', 'expense', '✈️', 8),
    (created_household_id, 'Подписки', 'expense', '◉', 9), (created_household_id, 'Прочее', 'expense', '•', 10);
  return created_household_id;
end;
$$;

create or replace function public.family_web_create_invite()
returns text language plpgsql security definer set search_path = public as $$
declare household uuid; token text;
begin
  select household_id into household from public.family_web_members where user_id = auth.uid() and role = 'owner';
  if household is null then raise exception 'Приглашение может создать только владелец семейного пространства.'; end if;
  if (select count(*) from public.family_web_members where household_id = household) >= 2 then raise exception 'В семейном пространстве уже два человека.'; end if;
  token := encode(gen_random_bytes(20), 'hex');
  insert into public.family_web_invites (household_id, token_hash, expires_at)
  values (household, encode(digest(token, 'sha256'), 'hex'), now() + interval '7 days');
  return token;
end;
$$;

create or replace function public.family_web_redeem_invite(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare invite public.family_web_invites; count_members integer;
begin
  if auth.uid() is null then raise exception 'Нужно войти в приложение.'; end if;
  perform public.family_web_ensure_profile();
  select * into invite from public.family_web_invites
  where token_hash = encode(digest(p_token, 'sha256'), 'hex') for update;
  if not found or invite.expires_at <= now() or invite.redeemed_at is not null then raise exception 'Приглашение недействительно или истекло.'; end if;
  if exists (select 1 from public.family_web_members where user_id = auth.uid()) then raise exception 'Вы уже состоите в семейном пространстве.'; end if;
  select count(*) into count_members from public.family_web_members where household_id = invite.household_id;
  if count_members >= 2 then raise exception 'В семейном пространстве уже два человека.'; end if;
  insert into public.family_web_members (household_id, user_id, role) values (invite.household_id, auth.uid(), 'member');
  update public.family_web_invites set redeemed_at = now(), redeemed_by = auth.uid() where id = invite.id;
end;
$$;

alter table public.family_web_profiles enable row level security;
alter table public.family_web_households enable row level security;
alter table public.family_web_members enable row level security;
alter table public.family_web_invites enable row level security;
alter table public.family_web_categories enable row level security;
alter table public.family_web_transactions enable row level security;
alter table public.family_web_tasks enable row level security;
alter table public.family_web_events enable row level security;
alter table public.family_web_shopping_lists enable row level security;
alter table public.family_web_shopping_items enable row level security;

create policy "family profiles visible to family" on public.family_web_profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.family_web_members own join public.family_web_members peer on peer.household_id = own.household_id
    where own.user_id = auth.uid() and peer.user_id = family_web_profiles.id
  )
);
create policy "family household read" on public.family_web_households for select to authenticated using (public.family_web_is_member(id));
create policy "family members read" on public.family_web_members for select to authenticated using (public.family_web_is_member(household_id));
create policy "family categories read" on public.family_web_categories for select to authenticated using (public.family_web_is_member(household_id));
create policy "family transactions read" on public.family_web_transactions for select to authenticated using (public.family_web_is_member(household_id));
create policy "family transactions insert" on public.family_web_transactions for insert to authenticated with check (public.family_web_is_member(household_id) and created_by = auth.uid());
create policy "family transactions update" on public.family_web_transactions for update to authenticated using (public.family_web_is_member(household_id)) with check (public.family_web_is_member(household_id));
create policy "family transactions delete" on public.family_web_transactions for delete to authenticated using (public.family_web_is_member(household_id));
create policy "family tasks read" on public.family_web_tasks for select to authenticated using (public.family_web_is_member(household_id));
create policy "family tasks insert" on public.family_web_tasks for insert to authenticated with check (public.family_web_is_member(household_id) and created_by = auth.uid());
create policy "family tasks update" on public.family_web_tasks for update to authenticated using (public.family_web_is_member(household_id)) with check (public.family_web_is_member(household_id));
create policy "family tasks delete" on public.family_web_tasks for delete to authenticated using (public.family_web_is_member(household_id));
create policy "family events read" on public.family_web_events for select to authenticated using (public.family_web_is_member(household_id));
create policy "family events insert" on public.family_web_events for insert to authenticated with check (public.family_web_is_member(household_id) and created_by = auth.uid());
create policy "family events update" on public.family_web_events for update to authenticated using (public.family_web_is_member(household_id)) with check (public.family_web_is_member(household_id));
create policy "family events delete" on public.family_web_events for delete to authenticated using (public.family_web_is_member(household_id));
create policy "family lists read" on public.family_web_shopping_lists for select to authenticated using (public.family_web_is_member(household_id));
create policy "family lists insert" on public.family_web_shopping_lists for insert to authenticated with check (public.family_web_is_member(household_id) and created_by = auth.uid());
create policy "family lists update" on public.family_web_shopping_lists for update to authenticated using (public.family_web_is_member(household_id)) with check (public.family_web_is_member(household_id));
create policy "family lists delete" on public.family_web_shopping_lists for delete to authenticated using (public.family_web_is_member(household_id));
create policy "family shopping read" on public.family_web_shopping_items for select to authenticated using (public.family_web_can_access_list(list_id));
create policy "family shopping insert" on public.family_web_shopping_items for insert to authenticated with check (public.family_web_can_access_list(list_id) and created_by = auth.uid());
create policy "family shopping update" on public.family_web_shopping_items for update to authenticated using (public.family_web_can_access_list(list_id)) with check (public.family_web_can_access_list(list_id));
create policy "family shopping delete" on public.family_web_shopping_items for delete to authenticated using (public.family_web_can_access_list(list_id));

revoke all on function public.family_web_is_member(uuid), public.family_web_is_owner(uuid), public.family_web_can_access_list(uuid), public.family_web_ensure_profile(), public.family_web_create_household(text), public.family_web_create_invite(), public.family_web_redeem_invite(text) from public;
grant execute on function public.family_web_create_household(text), public.family_web_create_invite(), public.family_web_redeem_invite(text) to authenticated;
grant execute on function public.family_web_is_member(uuid), public.family_web_is_owner(uuid), public.family_web_can_access_list(uuid) to authenticated;
