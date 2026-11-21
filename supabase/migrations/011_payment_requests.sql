-- Payment requests: ask a client to pay (an invoice, an advance, any amount) via a private link. Safe to re-run.
create table if not exists public.payment_requests (
  id bigint generated always as identity primary key,
  client_id bigint references public.clients(id) on delete set null,
  invoice_id bigint references public.invoices(id) on delete set null,
  amount numeric not null check (amount > 0), purpose text, due_date date,
  status text default 'Open',
  share_token uuid not null default gen_random_uuid() unique,
  claimed_ref text, claimed_at timestamptz,
  created_by uuid default auth.uid(), created_at timestamptz default now());

do $$
declare t text := 'payment_requests';
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

-- what the client sees at the private link
create or replace function public.public_payment_request(tok uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.payment_requests; co jsonb; cname text; inum text;
begin
  select * into r from public.payment_requests where share_token = tok;
  if r.id is null then return null; end if;
  select name into cname from public.clients where id = r.client_id;
  select number into inum from public.invoices where id = r.invoice_id;
  select data into co from public.company_profile where id = 1;
  return jsonb_build_object(
    'request', jsonb_build_object('amount', r.amount, 'purpose', r.purpose, 'due_date', r.due_date, 'status', r.status, 'claimed_ref', r.claimed_ref),
    'client', jsonb_build_object('name', cname), 'invoice', jsonb_build_object('number', inum),
    'company', jsonb_build_object('name', coalesce(co->>'name', 'Redeye Digital Solutions'), 'upi_id', co->>'upi_id', 'bank', co->'bank', 'email', co->>'email', 'phone', co->>'phone'));
end $$;

-- client says "I have paid" and gives the reference; the team confirms in the app
create or replace function public.claim_payment_request(tok uuid, ref text, who text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.payment_requests; rf text := left(btrim(coalesce(ref, '')), 120); w text := left(coalesce(nullif(btrim(who), ''), 'Client'), 80); cname text;
begin
  select * into r from public.payment_requests where share_token = tok;
  if r.id is null then raise exception 'This link is not valid'; end if;
  if r.status in ('Paid', 'Cancelled') then raise exception 'This request is already %', lower(r.status); end if;
  if length(rf) < 4 then raise exception 'Please enter the UPI / bank reference number'; end if;
  update public.payment_requests set status = 'Paid claimed', claimed_ref = rf, claimed_at = now() where id = r.id;
  select name into cname from public.clients where id = r.client_id;
  perform public.notify(public.role_ids('{admin,manager}'), '💸 Client says paid', coalesce(cname, w) || ' — ' || r.amount || ' (ref ' || rf || '). Please confirm.', '#/payment_requests');
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.public_payment_request(uuid), public.claim_payment_request(uuid, text, text) from public;
grant execute on function public.public_payment_request(uuid), public.claim_payment_request(uuid, text, text) to anon, authenticated;
