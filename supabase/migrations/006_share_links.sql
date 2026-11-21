-- Private share links for invoices & quotations (WhatsApp / email). Safe to re-run.
alter table public.invoices add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.quotes   add column if not exists share_token uuid not null default gen_random_uuid();
create unique index if not exists invoices_share_token on public.invoices (share_token);
create unique index if not exists quotes_share_token on public.quotes (share_token);

-- Returns one document by its secret token, to anyone holding the link (no login).
create or replace function public.public_doc(kind text, tok uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb; c jsonb; l jsonb; co jsonb;
begin
  if kind = 'inv' then select to_jsonb(i) - 'created_by' into d from public.invoices i where i.share_token = tok;
  elsif kind = 'quote' then select to_jsonb(q) - 'created_by' into d from public.quotes q where q.share_token = tok;
  end if;
  if d is null then return null; end if;
  select jsonb_build_object('name', name, 'address', address, 'gstin', gstin) into c from public.clients where id = (d->>'client_id')::bigint;
  if c is null and d->>'lead_id' is not null then
    select jsonb_build_object('name', coalesce(company, name)) into l from public.leads where id = (d->>'lead_id')::bigint;
  end if;
  select data into co from public.company_profile where id = 1;
  return jsonb_build_object('doc', d, 'client', c, 'lead', l, 'company', coalesce(co, '{}'::jsonb));
end $$;
revoke all on function public.public_doc(text, uuid) from public;
grant execute on function public.public_doc(text, uuid) to anon, authenticated;
