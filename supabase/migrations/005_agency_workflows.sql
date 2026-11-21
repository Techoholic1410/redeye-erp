-- Agency workflows: packages, content plans, content calendar/pipeline, shoots, meetings, quotes, freelancers.
-- Run after 001-004. Safe to re-run.

-- ============ client profile extras ============
alter table public.clients add column if not exists social_handles text;
alter table public.clients add column if not exists drive_link text;
alter table public.clients add column if not exists brand_notes text;
alter table public.clients add column if not exists account_manager_id uuid;
alter table public.clients add column if not exists onboarded_on date;

-- ============ tables ============
create table if not exists public.packages (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  name text not null, monthly_fee numeric, videos_per_month int, posts_per_month int, shoots_per_month int,
  tax_percent numeric default 0, billing_day int, start_date date, end_date date,
  status text default 'Active', inclusions text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table if not exists public.content_plans (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  month text not null, title text not null, objective text, themes text,
  cadence jsonb not null default '[]', status text default 'Draft', notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table if not exists public.shoots (
  id bigint generated always as identity primary key,
  title text not null, client_id bigint references public.clients(id) on delete set null,
  shoot_date date, call_time text, wrap_time text, location text, status text default 'Planned',
  director_id uuid, crew_ids jsonb not null default '[]', equipment_ids jsonb not null default '[]',
  talent text, props text, shot_list text, notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table if not exists public.content_items (
  id bigint generated always as identity primary key,
  plan_id bigint references public.content_plans(id) on delete set null,
  client_id bigint not null references public.clients(id) on delete cascade,
  title text not null, pillar text, format text, platform text,
  publish_date date, publish_time text, status text default 'Idea',
  concept text, script text, caption text, hashtags text,
  owner_id uuid, writer_id uuid, editor_id uuid, designer_id uuid,
  shoot_id bigint references public.shoots(id) on delete set null,
  edit_due date, client_status text default 'Not sent', client_feedback text, asset_link text,
  posted_url text, posted_on date, views int, reach int, likes int, comments int, shares int, saves int,
  created_by uuid default auth.uid(), created_at timestamptz default now());
create index if not exists content_items_date on public.content_items (publish_date);
create index if not exists content_items_client on public.content_items (client_id);

create table if not exists public.meetings (
  id bigint generated always as identity primary key,
  title text not null, client_id bigint references public.clients(id) on delete set null,
  kind text, meeting_date date, meeting_time text, location text, attendees text,
  agenda text, minutes text, action_items text, status text default 'Scheduled',
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table if not exists public.freelancers (
  id bigint generated always as identity primary key,
  name text not null, role text, phone text, email text, city text,
  rate numeric, rate_unit text, portfolio_link text, status text default 'Available', notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create sequence if not exists public.quote_seq;
create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  number text, client_id bigint references public.clients(id) on delete set null, lead_id bigint references public.leads(id) on delete set null,
  title text, issue_date date default current_date, valid_until date,
  items jsonb not null default '[]', tax_percent numeric default 0, subtotal numeric default 0, total numeric default 0,
  status text default 'Draft', notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

-- ============ quote totals + auto number ============
create or replace function public.trg_quotes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.subtotal := coalesce((select sum(coalesce((i->>'amount')::numeric,0)) from jsonb_array_elements(new.items) i), 0);
  new.total := round(new.subtotal * (1 + coalesce(new.tax_percent,0)/100), 2);
  if nullif(btrim(new.number),'') is null then
    if tg_op = 'UPDATE' and nullif(btrim(old.number),'') is not null then new.number := old.number;
    else new.number := 'RD/Q/' || to_char(coalesce(new.issue_date, current_date),'YYYY') || '-' || lpad(nextval('public.quote_seq')::text, 3, '0'); end if;
  end if;
  return new;
end $$;
drop trigger if exists quotes_calc on public.quotes;
create trigger quotes_calc before insert or update on public.quotes for each row execute function public.trg_quotes();

-- ============ notifications ============
create or replace function public.trg_content_after() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); who text := public.uname(auth.uid()); cname text; ttl text; u text := '#/content_items';
begin
  select name into cname from public.clients where id = new.client_id;
  ttl := new.title || coalesce(' · ' || cname, '');
  if new.writer_id   is not null and new.writer_id   is distinct from actor and (tg_op='INSERT' or old.writer_id   is distinct from new.writer_id)   then perform public.notify(array[new.writer_id],   'Script assigned to you', ttl || ' — by ' || who, u); end if;
  if new.editor_id   is not null and new.editor_id   is distinct from actor and (tg_op='INSERT' or old.editor_id   is distinct from new.editor_id)   then perform public.notify(array[new.editor_id],   'Edit assigned to you',   ttl || ' — by ' || who, u); end if;
  if new.designer_id is not null and new.designer_id is distinct from actor and (tg_op='INSERT' or old.designer_id is distinct from new.designer_id) then perform public.notify(array[new.designer_id], 'Design assigned to you', ttl || ' — by ' || who, u); end if;
  if new.owner_id    is not null and new.owner_id    is distinct from actor and (tg_op='INSERT' or old.owner_id    is distinct from new.owner_id)    then perform public.notify(array[new.owner_id],    'Content assigned to you', ttl || ' — by ' || who, u); end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'Ready to shoot' then perform public.notify(array_remove(array[new.owner_id], actor), 'Ready to shoot', ttl, u);
    elsif new.status = 'Shot' then perform public.notify(array_remove(array[new.editor_id], actor), 'Footage ready to edit', ttl, u);
    elsif new.status = 'Internal review' then perform public.notify(array_remove(public.role_ids('{admin,manager}') || array[new.owner_id], actor), 'Ready for internal review', ttl || ' — by ' || who, u);
    elsif new.status = 'Changes needed' then perform public.notify(array_remove(array[new.editor_id, new.designer_id, new.writer_id, new.owner_id], actor), 'Changes requested', ttl, u);
    elsif new.status = 'Approved' then perform public.notify(array_remove(array[new.owner_id, new.editor_id, new.designer_id], actor), 'Approved — ready to schedule', ttl, u);
    elsif new.status = 'Published' then perform public.notify(array_remove(array[new.owner_id], actor), 'Published', ttl, u);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists content_notify on public.content_items;
create trigger content_notify after insert or update on public.content_items for each row execute function public.trg_content_after();

create or replace function public.trg_shoots_after() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); who text := public.uname(auth.uid()); crew uuid[]; msg text; changed boolean;
begin
  select coalesce(array_agg(x::uuid), '{}') into crew from jsonb_array_elements_text(new.crew_ids) x;
  crew := array_remove(crew || array[new.director_id], actor);
  msg := new.title || ' — ' || coalesce(to_char(new.shoot_date,'DD Mon'),'date TBC') || coalesce(' at ' || new.call_time,'') || coalesce(' @ ' || new.location,'');
  if tg_op = 'INSERT' then
    perform public.notify(crew, 'Shoot scheduled', msg || ' (by ' || who || ')', '#/shoots');
  else
    changed := old.shoot_date is distinct from new.shoot_date or old.call_time is distinct from new.call_time or old.location is distinct from new.location;
    if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then perform public.notify(crew, 'Shoot cancelled', new.title, '#/shoots');
    elsif changed then perform public.notify(crew, 'Shoot updated', msg || ' (by ' || who || ')', '#/shoots');
    elsif old.crew_ids is distinct from new.crew_ids or old.director_id is distinct from new.director_id then
      perform public.notify(crew, 'You are on a shoot', msg, '#/shoots'); end if;
  end if;
  return new;
end $$;
drop trigger if exists shoots_notify on public.shoots;
create trigger shoots_notify after insert or update on public.shoots for each row execute function public.trg_shoots_after();

create or replace function public.trg_plans_after() returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('Pending approval','Approved') then
    select name into cname from public.clients where id = new.client_id;
    perform public.notify(array_remove(public.role_ids('{admin,manager}'), auth.uid()), 'Content plan ' || lower(new.status), new.title || coalesce(' · ' || cname,''), '#/content_plans');
  end if;
  return new;
end $$;
drop trigger if exists plans_notify on public.content_plans;
create trigger plans_notify after update on public.content_plans for each row execute function public.trg_plans_after();

create or replace function public.trg_quotes_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'Accepted' then
    perform public.notify(array_remove(public.role_ids('{admin,manager}'), auth.uid()), '🎉 Quote accepted', new.number || ' — ' || new.total, '#/quotes');
  end if;
  return new;
end $$;
drop trigger if exists quotes_notify on public.quotes;
create trigger quotes_notify after update on public.quotes for each row execute function public.trg_quotes_after();

-- ============ hourly sweep: add production reminders ============
create or replace function public.run_sweep() returns void language plpgsql security definer set search_path = public as $$
declare i record; t record; s record; c record; crew uuid[];
begin
  for i in update public.invoices set status = 'Overdue' where status = 'Sent' and due_date < current_date returning number, total loop
    perform public.notify(public.role_ids('{admin,manager}'), 'Invoice overdue', i.number || ' — ' || i.total, '#/invoices');
  end loop;
  for t in select * from public.tasks where status <> 'Done' and assignee_id is not null and due_date in (current_date, current_date + 1) loop
    begin
      insert into public.reminders (key) values ('task:' || t.id || ':' || t.due_date || ':' || current_date);
      perform public.notify(array[t.assignee_id], case when t.due_date = current_date then 'Task due today' else 'Task due tomorrow' end, t.title, '#/tasks');
    exception when unique_violation then null;
    end;
  end loop;
  -- shoots today / tomorrow → crew
  for s in select * from public.shoots where status in ('Planned','Confirmed') and shoot_date in (current_date, current_date + 1) loop
    begin
      insert into public.reminders (key) values ('shoot:' || s.id || ':' || s.shoot_date || ':' || current_date);
      select coalesce(array_agg(x::uuid), '{}') into crew from jsonb_array_elements_text(s.crew_ids) x;
      perform public.notify(crew || array[s.director_id], case when s.shoot_date = current_date then 'Shoot today' else 'Shoot tomorrow' end,
        s.title || coalesce(' at ' || s.call_time,'') || coalesce(' @ ' || s.location,''), '#/shoots');
    exception when unique_violation then null;
    end;
  end loop;
  -- posts due to go live today, edits due today/tomorrow
  for c in select * from public.content_items where status not in ('Published') and (publish_date = current_date or edit_due in (current_date, current_date + 1)) loop
    begin
      insert into public.reminders (key) values ('content:' || c.id || ':' || coalesce(c.publish_date::text,'') || ':' || coalesce(c.edit_due::text,'') || ':' || current_date);
      if c.publish_date = current_date then perform public.notify(array[c.owner_id], 'Post due today', c.title || ' (' || c.status || ')', '#/content_items'); end if;
      if c.edit_due in (current_date, current_date + 1) then perform public.notify(array[c.editor_id], 'Edit due ' || case when c.edit_due = current_date then 'today' else 'tomorrow' end, c.title, '#/content_items'); end if;
    exception when unique_violation then null;
    end;
  end loop;
end $$;
revoke all on function public.run_sweep() from public, anon, authenticated;

-- ============ access rules (row-level security) ============
do $$
declare r record;
begin
  for r in select * from (values
    ('packages',      '{admin,manager}',       '{admin,manager}',       '{admin,manager}',       '{admin}'),
    ('content_plans', '{admin,manager,staff}', '{admin,manager}',       '{admin,manager}',       '{admin,manager}'),
    ('content_items', '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager}'),
    ('shoots',        '{admin,manager,staff}', '{admin,manager}',       '{admin,manager,staff}', '{admin,manager}'),
    ('meetings',      '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager}'),
    ('freelancers',   '{admin,manager}',       '{admin,manager}',       '{admin,manager}',       '{admin}'),
    ('quotes',        '{admin,manager}',       '{admin,manager}',       '{admin,manager}',       '{admin}')
  ) as t(tbl, rd, cr, up, dl)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl||'_sel', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl||'_ins', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl||'_upd', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl||'_del', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = any(%L::text[]))', r.tbl||'_sel', r.tbl, r.rd);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() = any(%L::text[]))', r.tbl||'_ins', r.tbl, r.cr);
    execute format('create policy %I on public.%I for update to authenticated using (public.my_role() = any(%L::text[])) with check (public.my_role() = any(%L::text[]))', r.tbl||'_upd', r.tbl, r.up, r.up);
    execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() = any(%L::text[]))', r.tbl||'_del', r.tbl, r.dl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tbl);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;
