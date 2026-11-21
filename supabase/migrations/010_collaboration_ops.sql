-- Comments, equipment log, task templates, attachments (Storage), calendar feed token, reminders. Run after 009. Safe to re-run.

-- ============ comments ============
create table if not exists public.comments (
  id bigint generated always as identity primary key,
  entity text not null, record_id bigint not null, body text not null check (length(body) between 1 and 4000),
  mentions uuid[] not null default '{}',
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now());
create index if not exists comments_rec on public.comments (entity, record_id);

create or replace function public.trg_comments_after() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := public.uname(new.created_by); related uuid[] := '{}'; ci public.content_items; sh public.shoots; label text;
begin
  if new.entity = 'content_items' then
    select * into ci from public.content_items where id = new.record_id;
    related := array[ci.owner_id, ci.writer_id, ci.editor_id, ci.designer_id]; label := ci.title;
  elsif new.entity = 'shoots' then
    select * into sh from public.shoots where id = new.record_id;
    select coalesce(array_agg(x::uuid), '{}') || array[sh.director_id] into related from jsonb_array_elements_text(sh.crew_ids) x; label := sh.title;
  end if;
  perform public.notify(array_remove(new.mentions, new.created_by), 'You were mentioned by ' || who, coalesce(label || ': ', '') || left(new.body, 160), '#/' || new.entity);
  perform public.notify(array(select u from unnest(related) u where u is not null and u <> new.created_by and not (u = any(new.mentions))), 'New comment from ' || who, coalesce(label || ': ', '') || left(new.body, 160), '#/' || new.entity);
  return new;
end $$;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments for each row execute function public.trg_comments_after();

alter table public.comments enable row level security;
drop policy if exists comments_sel on public.comments; drop policy if exists comments_ins on public.comments; drop policy if exists comments_del on public.comments;
create policy comments_sel on public.comments for select to authenticated using (public.my_role() is not null);
create policy comments_ins on public.comments for insert to authenticated with check (public.my_role() is not null and created_by = auth.uid());
create policy comments_del on public.comments for delete to authenticated using (created_by = auth.uid() or public.my_role() in ('admin', 'manager'));
grant select, insert, delete on public.comments to authenticated;

-- ============ equipment check-out log ============
create table if not exists public.equipment_log (
  id bigint generated always as identity primary key,
  asset_id bigint not null references public.assets(id) on delete cascade,
  user_id uuid default auth.uid(), shoot_id bigint references public.shoots(id) on delete set null,
  out_date date not null default current_date, due_back date, returned_on date,
  condition_out text, condition_in text, notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create or replace function public.trg_equipment_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.returned_on is null then
    update public.assets set status = 'In use', assigned_to = new.user_id where id = new.asset_id;
  else
    update public.assets set status = case when condition_note_bad(new.condition_in) then 'Repair' else 'In stock' end, assigned_to = null
      where id = new.asset_id and not exists (select 1 from public.equipment_log e where e.asset_id = new.asset_id and e.returned_on is null and e.id <> new.id);
  end if;
  return new;
end $$;
create or replace function public.condition_note_bad(t text) returns boolean language sql immutable as $$
  select coalesce(t, '') ~* '(damage|broken|crack|repair|not working|faulty)' $$;
drop trigger if exists equipment_sync on public.equipment_log;
create trigger equipment_sync after insert or update on public.equipment_log for each row execute function public.trg_equipment_after();

do $$
declare t text := 'equipment_log';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t||'_sel', t); execute format('drop policy if exists %I on public.%I', t||'_ins', t);
  execute format('drop policy if exists %I on public.%I', t||'_upd', t); execute format('drop policy if exists %I on public.%I', t||'_del', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.my_role() is not null)', t||'_sel', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() is not null)', t||'_ins', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.my_role() is not null) with check (public.my_role() is not null)', t||'_upd', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() in (''admin'',''manager''))', t||'_del', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $$;

-- ============ task templates ============
create table if not exists public.task_templates (
  id bigint generated always as identity primary key,
  name text not null unique, description text,
  items jsonb not null default '[]',   -- [{title, days, priority}] days = offset from the start date (negative = before)
  created_by uuid default auth.uid(), created_at timestamptz default now());

do $$
declare t text := 'task_templates';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t||'_sel', t); execute format('drop policy if exists %I on public.%I', t||'_ins', t);
  execute format('drop policy if exists %I on public.%I', t||'_upd', t); execute format('drop policy if exists %I on public.%I', t||'_del', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.my_role() is not null)', t||'_sel', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() in (''admin'',''manager''))', t||'_ins', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.my_role() in (''admin'',''manager'')) with check (public.my_role() in (''admin'',''manager''))', t||'_upd', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() in (''admin'',''manager''))', t||'_del', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $$;

insert into public.task_templates (name, description, items) values
 ('Client onboarding', 'Steps after a new client signs', '[{"title":"Sign agreement & collect advance","days":2,"priority":"High"},{"title":"Collect brand assets, logos & guidelines","days":3,"priority":"High"},{"title":"Get access to social accounts","days":3,"priority":"High"},{"title":"Kickoff meeting with client","days":5,"priority":"Medium"},{"title":"Create month-1 content plan","days":7,"priority":"High"},{"title":"Schedule first shoot","days":10,"priority":"Medium"}]'),
 ('Shoot day checklist', 'Use on a shoot: dates are relative to the shoot date', '[{"title":"Confirm location & permissions","days":-3,"priority":"High"},{"title":"Confirm crew & talent","days":-2,"priority":"High"},{"title":"Charge batteries, format cards, pack kit","days":-1,"priority":"Medium"},{"title":"Share call sheet with crew and client","days":-1,"priority":"Medium"},{"title":"Back up footage on site","days":0,"priority":"High"},{"title":"Share footage with editor","days":1,"priority":"High"}]'),
 ('Monthly content cycle', 'Repeat every month for a retainer client', '[{"title":"Draft content plan for the month","days":1,"priority":"High"},{"title":"Client approval of the plan","days":4,"priority":"High"},{"title":"Write scripts for weeks 1-2","days":6,"priority":"Medium"},{"title":"Shoot day(s)","days":10,"priority":"High"},{"title":"First edits ready for review","days":14,"priority":"Medium"},{"title":"Send monthly report to client","days":28,"priority":"Medium"}]'),
 ('Month-end close', 'Money housekeeping', '[{"title":"Follow up unpaid invoices","days":1,"priority":"High"},{"title":"Record all payments & expenses","days":2,"priority":"Medium"},{"title":"Pay freelancers","days":3,"priority":"High"},{"title":"Send client reports","days":4,"priority":"Medium"}]')
on conflict (name) do nothing;

-- ============ attachments (files in Supabase Storage, bucket "files") ============
insert into storage.buckets (id, name, public, file_size_limit) values ('files', 'files', false, 52428800) on conflict (id) do nothing;
drop policy if exists files_read on storage.objects; drop policy if exists files_write on storage.objects; drop policy if exists files_delete on storage.objects;
create policy files_read   on storage.objects for select to authenticated using (bucket_id = 'files' and public.my_role() is not null);
create policy files_write  on storage.objects for insert to authenticated with check (bucket_id = 'files' and public.my_role() is not null);
create policy files_delete on storage.objects for delete to authenticated using (bucket_id = 'files' and (owner_id = auth.uid()::text or public.my_role() in ('admin', 'manager')));

create table if not exists public.attachments (
  id bigint generated always as identity primary key,
  entity text not null, record_id bigint not null, name text not null, path text not null, size bigint, mime text,
  created_by uuid default auth.uid(), created_at timestamptz default now());
create index if not exists attachments_rec on public.attachments (entity, record_id);
alter table public.attachments enable row level security;
drop policy if exists att_sel on public.attachments; drop policy if exists att_ins on public.attachments; drop policy if exists att_del on public.attachments;
create policy att_sel on public.attachments for select to authenticated using (public.my_role() is not null);
create policy att_ins on public.attachments for insert to authenticated with check (public.my_role() is not null and created_by = auth.uid());
create policy att_del on public.attachments for delete to authenticated using (created_by = auth.uid() or public.my_role() in ('admin', 'manager'));
grant select, insert, delete on public.attachments to authenticated;

-- ============ calendar feed token (per user) ============
create table if not exists public.calendar_tokens (user_id uuid primary key references auth.users(id) on delete cascade, token uuid not null default gen_random_uuid() unique);
alter table public.calendar_tokens enable row level security;   -- no policies: only through my_calendar_token()
create or replace function public.my_calendar_token() returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if public.my_role() is null then raise exception 'Not allowed'; end if;
  insert into public.calendar_tokens (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select token into t from public.calendar_tokens where user_id = auth.uid();
  return t;
end $$;
revoke all on function public.my_calendar_token() from public, anon;
grant execute on function public.my_calendar_token() to authenticated;

-- the calendar-feed Edge Function runs as service_role
grant select on public.calendar_tokens, public.shoots, public.content_items, public.tasks, public.meetings, public.clients, public.profiles to service_role;

grant usage, select on all sequences in schema public to authenticated;

-- ============ hourly sweep (final version): overdue incl. part-paid, retainers, shoots, content, returns ============
create or replace function public.run_sweep() returns void language plpgsql security definer set search_path = public as $$
declare i record; t record; s record; c record; e record; crew uuid[];
begin
  for i in update public.invoices set status = 'Overdue' where status in ('Sent', 'Partial') and due_date < current_date returning number, total, amount_paid loop
    perform public.notify(public.role_ids('{admin,manager}'), 'Invoice overdue', i.number || ' — balance ' || (i.total - i.amount_paid), '#/invoices');
  end loop;
  perform public.raise_retainer_invoices();
  for t in select * from public.tasks where status <> 'Done' and assignee_id is not null and due_date in (current_date, current_date + 1) loop
    begin
      insert into public.reminders (key) values ('task:' || t.id || ':' || t.due_date || ':' || current_date);
      perform public.notify(array[t.assignee_id], case when t.due_date = current_date then 'Task due today' else 'Task due tomorrow' end, t.title, '#/tasks');
    exception when unique_violation then null;
    end;
  end loop;
  for s in select * from public.shoots where status in ('Planned', 'Confirmed') and shoot_date in (current_date, current_date + 1) loop
    begin
      insert into public.reminders (key) values ('shoot:' || s.id || ':' || s.shoot_date || ':' || current_date);
      select coalesce(array_agg(x::uuid), '{}') into crew from jsonb_array_elements_text(s.crew_ids) x;
      perform public.notify(crew || array[s.director_id], case when s.shoot_date = current_date then 'Shoot today' else 'Shoot tomorrow' end,
        s.title || coalesce(' at ' || s.call_time, '') || coalesce(' @ ' || s.location, ''), '#/shoots');
    exception when unique_violation then null;
    end;
  end loop;
  for c in select * from public.content_items where status not in ('Published') and (publish_date = current_date or edit_due in (current_date, current_date + 1)) loop
    begin
      insert into public.reminders (key) values ('content:' || c.id || ':' || coalesce(c.publish_date::text, '') || ':' || coalesce(c.edit_due::text, '') || ':' || current_date);
      if c.publish_date = current_date then perform public.notify(array[c.owner_id], 'Post due today', c.title || ' (' || c.status || ')', '#/content_items'); end if;
      if c.edit_due in (current_date, current_date + 1) then perform public.notify(array[c.editor_id], 'Edit due ' || case when c.edit_due = current_date then 'today' else 'tomorrow' end, c.title, '#/content_items'); end if;
    exception when unique_violation then null;
    end;
  end loop;
  for e in select l.*, a.name as aname from public.equipment_log l join public.assets a on a.id = l.asset_id where l.returned_on is null and l.due_back < current_date loop
    begin
      insert into public.reminders (key) values ('gear:' || e.id || ':' || current_date);
      perform public.notify(array[e.user_id], 'Equipment overdue', e.aname || ' was due back ' || e.due_back, '#/equipment_log');
    exception when unique_violation then null;
    end;
  end loop;
end $$;
revoke all on function public.run_sweep() from public, anon, authenticated;
