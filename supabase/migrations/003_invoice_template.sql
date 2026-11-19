-- Invoice template support (Redeye standard layout). Run after 001/002. Safe to re-run.

alter table public.clients  add column if not exists code text;                 -- short code used in invoice numbers, e.g. GC
alter table public.invoices add column if not exists client_ref text;           -- "Client Ref." line on the invoice
alter table public.invoices add column if not exists deductions jsonb not null default '[]';  -- [{label, amount}] e.g. Advance received
alter table public.invoices add column if not exists carry_forward numeric;     -- "Balance carried forward" (optional)
alter table public.invoices add column if not exists videos_committed int;      -- Delivery status block (optional)
alter table public.invoices add column if not exists videos_delivered int;
alter table public.invoices alter column tax_percent set default 0;

-- Line items are now {desc, note, amount}; older {qty, rate} items still work.
-- total = amount payable now = subtotal + tax - deductions - carry_forward.
-- Invoice number: type your own, or leave empty to get RD/<year>/<client code>-NN (e.g. RD/2026/GC-05).
create or replace function public.trg_invoices() returns trigger language plpgsql security definer set search_path = public as $$
declare pfx text; code text; n int;
begin
  new.subtotal := coalesce((select sum(coalesce((i->>'amount')::numeric, coalesce((i->>'qty')::numeric,0) * coalesce((i->>'rate')::numeric,0)))
                            from jsonb_array_elements(new.items) i), 0);
  new.total := round(new.subtotal * (1 + coalesce(new.tax_percent,0)/100)
                     - coalesce((select sum(coalesce((d->>'amount')::numeric,0)) from jsonb_array_elements(new.deductions) d), 0)
                     - coalesce(new.carry_forward,0), 2);
  if nullif(btrim(new.number),'') is null then
    if tg_op = 'UPDATE' and nullif(btrim(old.number),'') is not null then
      new.number := old.number;
    else
      select upper(regexp_replace(coalesce(c.code,''), '[^A-Za-z0-9]', '', 'g')) into code from public.clients c where c.id = new.client_id;
      if coalesce(code,'') <> '' then
        pfx := 'RD/' || to_char(coalesce(new.issue_date, current_date),'YYYY') || '/' || code || '-';
        select coalesce(max(nullif(regexp_replace(number, '^.*-', ''), '')::int), 0) + 1 into n
          from public.invoices where number like pfx || '%' and number ~ '-[0-9]+$';
        new.number := pfx || lpad(n::text, 2, '0');
      else
        new.number := 'RD-INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
      end if;
    end if;
  end if;
  return new;
end $$;

-- Company + bank details printed on invoices. Visible to admins/managers only (never in the public website files).
create table if not exists public.company_profile (id int primary key default 1 check (id = 1), data jsonb not null default '{}');
alter table public.company_profile enable row level security;
drop policy if exists company_sel on public.company_profile;
drop policy if exists company_upd on public.company_profile;
drop policy if exists company_ins on public.company_profile;
create policy company_sel on public.company_profile for select to authenticated using (public.my_role() in ('admin','manager'));
create policy company_ins on public.company_profile for insert to authenticated with check (public.my_role() = 'admin');
create policy company_upd on public.company_profile for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
grant select, insert, update on public.company_profile to authenticated;
