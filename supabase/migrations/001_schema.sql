-- Redeye ERP — Supabase schema. Run once in: Supabase Dashboard → SQL Editor (or `supabase db push`).

-- ============ profiles (one per login) ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'staff' check (role in ('admin','manager','staff')),
  active text not null default 'No' check (active in ('Yes','No')),
  created_at timestamptz not null default now()
);

-- First person to ever sign up becomes the admin. Everyone else starts INACTIVE
-- until an admin activates them (so open sign-ups can never grant access).
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, name, email, role, active)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)), new.email,
          case when first_user then 'admin' else 'staff' end, case when first_user then 'Yes' else 'No' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============ helpers ============
create function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active = 'Yes' $$;
create function public.role_ids(r text[]) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.profiles where active = 'Yes' and role = any(r) $$;
create function public.uname(u uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = u), 'Someone') $$;

-- ============ business tables ============
create table public.clients (
  id bigint generated always as identity primary key,
  name text not null, contact_person text, email text, phone text, gstin text,
  status text default 'Active', address text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.leads (
  id bigint generated always as identity primary key,
  name text not null, company text, email text, phone text, source text, value numeric,
  stage text default 'New', owner_id uuid, notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.projects (
  id bigint generated always as identity primary key,
  name text not null, client_id bigint references public.clients(id) on delete set null,
  status text default 'Planning', manager_id uuid, start_date date, due_date date, budget numeric, description text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.tasks (
  id bigint generated always as identity primary key,
  title text not null, project_id bigint references public.projects(id) on delete set null,
  assignee_id uuid, priority text default 'Medium', status text default 'To do', due_date date, description text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create sequence public.invoice_seq;
create table public.invoices (
  id bigint generated always as identity primary key,
  number text unique,
  client_id bigint not null references public.clients(id) on delete restrict,
  project_id bigint references public.projects(id) on delete set null,
  issue_date date default current_date, due_date date,
  items jsonb not null default '[]', tax_percent numeric default 18,
  status text default 'Draft' check (status in ('Draft','Sent','Paid','Overdue','Cancelled')),
  subtotal numeric default 0, total numeric default 0, notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.expenses (
  id bigint generated always as identity primary key,
  date date not null default current_date, category text, description text not null, amount numeric not null,
  project_id bigint references public.projects(id) on delete set null,
  status text default 'Pending' check (status in ('Pending','Approved','Rejected','Reimbursed')),
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.employees (
  id bigint generated always as identity primary key,
  name text not null, email text, phone text, designation text, department text, join_date date,
  status text default 'Active',
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.leaves (
  id bigint generated always as identity primary key,
  user_id uuid, type text not null, from_date date not null, to_date date not null, reason text,
  status text default 'Pending' check (status in ('Pending','Approved','Rejected')),
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.attendance (
  id bigint generated always as identity primary key,
  user_id uuid not null, date date not null default current_date, check_in text, check_out text,
  created_by uuid default auth.uid(), created_at timestamptz default now(),
  unique (user_id, date));

create table public.tickets (
  id bigint generated always as identity primary key,
  subject text not null, client_id bigint references public.clients(id) on delete set null,
  priority text default 'Medium', status text default 'Open', assignee_id uuid, description text,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create table public.assets (
  id bigint generated always as identity primary key,
  name text not null, category text, serial text, assigned_to uuid, status text default 'In stock',
  purchase_date date, cost numeric,
  created_by uuid default auth.uid(), created_at timestamptz default now());

-- ============ notifications + push ============
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null, title text not null, body text, url text default '#/',
  read boolean not null default false, created_at timestamptz not null default now());
create index on public.notifications (user_id, id desc);

create table public.push_subs (
  id bigint generated always as identity primary key,
  user_id uuid not null, endpoint text unique not null, data jsonb not null);
create table public.reminders (key text primary key);
create table public.app_settings (key text primary key, value text);   -- push_url, push_secret (service-only)

create function public.notify(uids uuid[], t text, b text, u text default '#/') returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, url)
  select distinct x, t, b, u from unnest(uids) x where x is not null $$;
revoke all on function public.notify(uuid[], text, text, text) from public, anon, authenticated;

-- every new notification → Edge Function (web push). Failure never blocks the insert.
create function public.push_on_notification() returns trigger language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from public.app_settings where key = 'push_url';
  select value into s from public.app_settings where key = 'push_secret';
  if u is not null then
    begin
      perform net.http_post(url := u, body := jsonb_build_object('record', to_jsonb(new)),
        headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret', coalesce(s,'')));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
create trigger notif_push after insert on public.notifications for each row execute function public.push_on_notification();

-- ============ business rules (triggers) ============
create function public.trg_invoices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.subtotal := coalesce((select sum(coalesce((i->>'qty')::numeric,0) * coalesce((i->>'rate')::numeric,0)) from jsonb_array_elements(new.items) i), 0);
  new.total := round(new.subtotal * (1 + coalesce(new.tax_percent,0)/100), 2);
  if tg_op = 'INSERT' then new.number := 'RD-INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
  else new.number := old.number; end if;
  return new;
end $$;
create trigger invoices_calc before insert or update on public.invoices for each row execute function public.trg_invoices();

create function public.trg_invoices_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Paid' and (tg_op = 'INSERT' or old.status is distinct from 'Paid') then
    perform public.notify(public.role_ids('{admin,manager}'), 'Invoice paid', new.number || ' — ' || new.total, '#/invoices'); end if;
  return new;
end $$;
create trigger invoices_notify after insert or update on public.invoices for each row execute function public.trg_invoices_after();

create function public.trg_tasks_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.assignee_id is distinct from new.assignee_id) then
    perform public.notify(array[new.assignee_id], 'New task assigned', new.title, '#/tasks'); end if;
  return new;
end $$;
create trigger tasks_notify after insert or update on public.tasks for each row execute function public.trg_tasks_after();

create function public.trg_leaves_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'staff' then new.user_id := auth.uid(); if tg_op = 'INSERT' then new.status := 'Pending'; end if;
  elsif new.user_id is null then new.user_id := auth.uid(); end if;
  return new;
end $$;
create trigger leaves_before before insert or update on public.leaves for each row execute function public.trg_leaves_before();

create function public.trg_leaves_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(array_remove(public.role_ids('{admin,manager}'), auth.uid()), 'Leave request',
      public.uname(new.user_id) || ': ' || new.type || ' ' || new.from_date || ' → ' || new.to_date, '#/leaves');
  elsif new.status is distinct from old.status then
    perform public.notify(array[new.user_id], 'Leave ' || lower(new.status), new.type || ' ' || new.from_date || ' → ' || new.to_date, '#/leaves');
  end if;
  return new;
end $$;
create trigger leaves_notify after insert or update on public.leaves for each row execute function public.trg_leaves_after();

create function public.trg_tickets_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(array_remove(public.role_ids('{admin,manager}'), auth.uid()), 'New support ticket', new.subject, '#/tickets'); end if;
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.assignee_id is distinct from new.assignee_id) then
    perform public.notify(array[new.assignee_id], 'Ticket assigned to you', new.subject, '#/tickets'); end if;
  return new;
end $$;
create trigger tickets_notify after insert or update on public.tickets for each row execute function public.trg_tickets_after();

create function public.trg_leads_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'Won' and (tg_op = 'INSERT' or old.stage is distinct from 'Won') then
    perform public.notify(public.role_ids('{admin,manager}'), '🎉 Lead won', new.name || ' — ' || coalesce(new.value,0), '#/leads'); end if;
  return new;
end $$;
create trigger leads_notify after insert or update on public.leads for each row execute function public.trg_leads_after();

create function public.trg_expenses_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() = 'staff' and tg_op = 'INSERT' then new.status := 'Pending'; end if;
  return new;
end $$;
create trigger expenses_before before insert on public.expenses for each row execute function public.trg_expenses_before();

create function public.trg_expenses_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(array_remove(public.role_ids('{admin,manager}'), auth.uid()), 'Expense submitted',
      public.uname(new.created_by) || ': ' || new.description || ' (' || new.amount || ')', '#/expenses');
  elsif new.status is distinct from old.status then
    perform public.notify(array[new.created_by], 'Expense ' || lower(new.status), new.description, '#/expenses');
  end if;
  return new;
end $$;
create trigger expenses_notify after insert or update on public.expenses for each row execute function public.trg_expenses_after();

-- ============ row level security ============
-- (table, who can read, create, update, delete, column that scopes STAFF to their own rows)
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.my_role() is not null);
create policy profiles_update on public.profiles for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

do $$
declare r record; own text;
begin
  for r in select * from (values
    ('clients',    '{admin,manager,staff}', '{admin,manager}',       '{admin,manager}',       '{admin}',         null),
    ('leads',      '{admin,manager,staff}', '{admin,manager}',       '{admin,manager}',       '{admin}',         null),
    ('projects',   '{admin,manager,staff}', '{admin,manager}',       '{admin,manager}',       '{admin}',         null),
    ('tasks',      '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager}', null),
    ('invoices',   '{admin,manager}',       '{admin,manager}',       '{admin,manager}',       '{admin}',         null),
    ('expenses',   '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager}',       '{admin}',         'created_by'),
    ('employees',  '{admin,manager}',       '{admin}',               '{admin}',               '{admin}',         null),
    ('leaves',     '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager}',       '{admin}',         'user_id'),
    ('attendance', '{admin,manager,staff}', '{admin}',               '{admin}',               '{admin}',         'user_id'),
    ('tickets',    '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager,staff}', '{admin,manager}', null),
    ('assets',     '{admin,manager,staff}', '{admin,manager}',       '{admin,manager}',       '{admin}',         null)
  ) as t(tbl, rd, cr, up, dl, scope)
  loop
    own := case when r.scope is null then '' else format(' and (public.my_role() <> ''staff'' or %I = auth.uid())', r.scope) end;
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.my_role() = any(%L::text[])%s)', r.tbl||'_sel', r.tbl, r.rd, own);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() = any(%L::text[])%s)', r.tbl||'_ins', r.tbl, r.cr, own);
    execute format('create policy %I on public.%I for update to authenticated using (public.my_role() = any(%L::text[])) with check (public.my_role() = any(%L::text[]))', r.tbl||'_upd', r.tbl, r.up, r.up);
    execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() = any(%L::text[]))', r.tbl||'_del', r.tbl, r.dl);
  end loop;
end $$;

alter table public.notifications enable row level security;
create policy notif_sel on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_upd on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.push_subs enable row level security;      -- no policies: only via save_push_sub()
alter table public.reminders enable row level security;
alter table public.app_settings enable row level security;

-- ============ RPC functions called by the app ============
create function public.attendance_today() returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(a) from public.attendance a where user_id = auth.uid() and date = current_date and public.my_role() is not null $$;

create function public.attendance_toggle() returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := to_char(now() at time zone coalesce(current_setting('app.tz', true), 'Asia/Kolkata'), 'HH24:MI'); a public.attendance;
begin
  if public.my_role() is null then raise exception 'Not allowed'; end if;
  select * into a from public.attendance where user_id = auth.uid() and date = current_date;
  if not found then insert into public.attendance (user_id, check_in) values (auth.uid(), t);
  elsif a.check_out is null then update public.attendance set check_out = t where id = a.id; end if;
  return public.attendance_today();
end $$;

create function public.save_push_sub(sub jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not allowed'; end if;
  insert into public.push_subs (user_id, endpoint, data) values (auth.uid(), sub->>'endpoint', sub)
  on conflict (endpoint) do update set user_id = excluded.user_id, data = excluded.data;
end $$;
create function public.delete_push_sub(ep text) returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = ep and user_id = auth.uid() $$;
create function public.send_test_notification() returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not allowed'; end if;
  perform public.notify(array[auth.uid()], 'Redeye ERP', 'Notifications are working 🎉', '#/');
end $$;

create function public.dashboard() returns jsonb language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); d date := current_date; mth text := to_char(current_date, 'YYYY-MM'); o jsonb;
begin
  if r is null then raise exception 'Not allowed'; end if;
  o := jsonb_build_object(
    'myTasks', coalesce((select jsonb_agg(t) from (select id,title,due_date,priority,status from public.tasks
               where assignee_id = auth.uid() and status <> 'Done' order by due_date nulls last limit 8) t), '[]'),
    'activeProjects', (select count(*) from public.projects where status = 'Active'),
    'openTickets', (select count(*) from public.tickets where status not in ('Resolved','Closed')),
    'openLeads', (select jsonb_build_object('n', count(*), 'v', coalesce(sum(value),0)) from public.leads where stage not in ('Won','Lost')),
    'onLeave', coalesce((select jsonb_agg(public.uname(user_id)) from public.leaves where status = 'Approved' and d between from_date and to_date), '[]'),
    'pendingLeaves', case when r = 'staff' then 0 else (select count(*) from public.leaves where status = 'Pending') end);
  if r <> 'staff' then
    o := o || jsonb_build_object(
      'outstanding', (select jsonb_build_object('v', coalesce(sum(total),0), 'n', count(*)) from public.invoices where status in ('Sent','Overdue')),
      'overdue', (select jsonb_build_object('v', coalesce(sum(total),0), 'n', count(*)) from public.invoices where status = 'Overdue'),
      'revenueMonth', (select coalesce(sum(total),0) from public.invoices where status = 'Paid' and to_char(issue_date,'YYYY-MM') = mth),
      'expenseMonth', (select coalesce(sum(amount),0) from public.expenses where status in ('Approved','Reimbursed') and to_char(date,'YYYY-MM') = mth),
      'pendingExpenses', (select count(*) from public.expenses where status = 'Pending'),
      'trend', (select jsonb_agg(jsonb_build_object('m', to_char(g,'YYYY-MM'),
          'revenue', (select coalesce(sum(total),0) from public.invoices where status = 'Paid' and to_char(issue_date,'YYYY-MM') = to_char(g,'YYYY-MM')),
          'expenses', (select coalesce(sum(amount),0) from public.expenses where status in ('Approved','Reimbursed') and to_char(date,'YYYY-MM') = to_char(g,'YYYY-MM'))) order by g)
          from generate_series(date_trunc('month', d) - interval '5 months', date_trunc('month', d), interval '1 month') g));
  end if;
  return o;
end $$;

-- hourly job: mark overdue invoices, remind about tasks due today/tomorrow
create function public.run_sweep() returns void language plpgsql security definer set search_path = public as $$
declare i record; t record;
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
end $$;
revoke all on function public.run_sweep() from public, anon, authenticated;

-- lock RPCs to signed-in users
revoke execute on function public.attendance_toggle(), public.attendance_today(), public.save_push_sub(jsonb), public.delete_push_sub(text),
  public.send_test_notification(), public.dashboard() from public, anon;
grant execute on function public.attendance_toggle(), public.attendance_today(), public.save_push_sub(jsonb), public.delete_push_sub(text),
  public.send_test_notification(), public.dashboard() to authenticated;
