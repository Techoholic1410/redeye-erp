-- Payments, receivables, retainer invoices, freelancer payouts. Run after 008. Safe to re-run.

alter table public.expenses add column if not exists client_id bigint references public.clients(id) on delete set null;
alter table public.expenses add column if not exists freelancer_id bigint references public.freelancers(id) on delete set null;
do $$ begin
  alter table public.invoices add constraint invoices_package_fk foreign key (package_id) references public.packages(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_on date not null default current_date,
  method text, reference text, notes text,
  created_by uuid default auth.uid(), created_at timestamptz default now());
create index if not exists payments_invoice on public.payments (invoice_id);

-- keep invoices.amount_paid and status in step with the payments recorded
create or replace function public.trg_payments_after() returns trigger language plpgsql security definer set search_path = public as $$
declare iid bigint := coalesce(new.invoice_id, old.invoice_id); paid numeric; inv public.invoices;
begin
  select * into inv from public.invoices where id = iid;
  if inv.id is null then return coalesce(new, old); end if;
  select coalesce(sum(amount), 0) into paid from public.payments where invoice_id = iid;
  update public.invoices set amount_paid = paid,
    status = case
      when status = 'Cancelled' then status
      when total > 0 and paid >= total then 'Paid'
      when paid > 0 then case when status in ('Paid', 'Draft') then 'Partial' else coalesce(nullif(status, 'Sent'), 'Partial') end
      when status in ('Paid', 'Partial') then 'Sent'
      else status end
    where id = iid;
  if tg_op = 'INSERT' and coalesce(new.reference, '') <> 'Backfilled' then
    perform public.notify(array_remove(public.role_ids('{admin,manager}'), auth.uid()), '💰 Payment received', inv.number || ' — ' || new.amount || coalesce(' via ' || new.method, ''), '#/payments');
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists payments_sync on public.payments;
create trigger payments_sync after insert or update or delete on public.payments for each row execute function public.trg_payments_after();

-- existing invoices already marked Paid get a matching payment record
insert into public.payments (invoice_id, amount, paid_on, method, reference)
select i.id, i.total, coalesce(i.issue_date, current_date), 'Imported', 'Backfilled'
from public.invoices i
where i.status = 'Paid' and i.total > 0 and not exists (select 1 from public.payments p where p.invoice_id = i.id);

do $$
declare t text := 'payments';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t||'_sel', t); execute format('drop policy if exists %I on public.%I', t||'_ins', t);
  execute format('drop policy if exists %I on public.%I', t||'_upd', t); execute format('drop policy if exists %I on public.%I', t||'_del', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.my_role() in (''admin'',''manager''))', t||'_sel', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() in (''admin'',''manager''))', t||'_ins', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.my_role() in (''admin'',''manager'')) with check (public.my_role() in (''admin'',''manager''))', t||'_upd', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() = ''admin'')', t||'_del', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- ============ monthly retainer invoices (drafts) ============
create or replace function public.raise_retainer_invoices() returns int language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; vids int; mth text := to_char(current_date, 'YYYY-MM'); last_day int := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'));
begin
  for p in select pk.*, c.name as cname from public.packages pk join public.clients c on c.id = pk.client_id
           where pk.status = 'Active' and pk.monthly_fee is not null and pk.billing_day is not null
             and least(pk.billing_day, last_day) = extract(day from current_date)::int
             and (pk.start_date is null or pk.start_date <= current_date) and (pk.end_date is null or pk.end_date >= current_date)
             and not exists (select 1 from public.invoices i where i.package_id = pk.id and to_char(i.issue_date, 'YYYY-MM') = mth)
  loop
    select count(*) into vids from public.content_items ci where ci.client_id = p.client_id and ci.status = 'Published'
      and ci.format in ('Reel', 'YouTube video', 'YouTube Short') and to_char(coalesce(ci.posted_on, ci.publish_date), 'YYYY-MM') = mth;
    insert into public.invoices (client_id, client_ref, issue_date, due_date, items, tax_percent, videos_committed, videos_delivered, status, package_id)
    values (p.client_id, p.cname || ' – ' || p.name, current_date, current_date + 7,
      jsonb_build_array(jsonb_build_object('desc', p.name || ' — ' || to_char(current_date, 'FMMonth YYYY'), 'note', split_part(coalesce(p.inclusions, ''), E'\n', 1), 'amount', p.monthly_fee)),
      coalesce(p.tax_percent, 0), p.videos_per_month, vids, 'Draft', p.id);
    n := n + 1;
  end loop;
  if n > 0 then perform public.notify(public.role_ids('{admin,manager}'), 'Retainer invoices drafted', n || ' draft invoice(s) are ready to review and send', '#/invoices'); end if;
  return n;
end $$;
revoke all on function public.raise_retainer_invoices() from public, anon, authenticated;

-- ============ dashboard: collected cash and balances ============
create or replace function public.dashboard() returns jsonb language plpgsql security definer set search_path = public as $$
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
      'outstanding', (select jsonb_build_object('v', coalesce(sum(total - amount_paid),0), 'n', count(*)) from public.invoices where status in ('Sent','Overdue','Partial')),
      'overdue', (select jsonb_build_object('v', coalesce(sum(total - amount_paid),0), 'n', count(*)) from public.invoices where status = 'Overdue' or (status = 'Partial' and due_date < current_date)),
      'revenueMonth', (select coalesce(sum(amount),0) from public.payments where to_char(paid_on,'YYYY-MM') = mth),
      'expenseMonth', (select coalesce(sum(amount),0) from public.expenses where status in ('Approved','Reimbursed') and to_char(date,'YYYY-MM') = mth),
      'pendingExpenses', (select count(*) from public.expenses where status = 'Pending'),
      'trend', (select jsonb_agg(jsonb_build_object('m', to_char(g,'YYYY-MM'),
          'revenue', (select coalesce(sum(amount),0) from public.payments where to_char(paid_on,'YYYY-MM') = to_char(g,'YYYY-MM')),
          'expenses', (select coalesce(sum(amount),0) from public.expenses where status in ('Approved','Reimbursed') and to_char(date,'YYYY-MM') = to_char(g,'YYYY-MM'))) order by g)
          from generate_series(date_trunc('month', d) - interval '5 months', date_trunc('month', d), interval '1 month') g));
  end if;
  return o;
end $$;
revoke execute on function public.dashboard() from public, anon;
grant execute on function public.dashboard() to authenticated;
