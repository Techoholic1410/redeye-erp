-- CRM upgrade: activity timeline, automatic stage history, lost reasons. Run after 014. Safe to re-run.
alter table public.leads add column if not exists lost_reason text;

create table if not exists public.lead_activities (
  id bigint generated always as identity primary key,
  lead_id bigint not null references public.leads(id) on delete cascade,
  kind text not null,                -- Created | Stage | Call | WhatsApp | Email | Meeting | Note
  body text, from_stage text, to_stage text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now());
create index if not exists lead_activities_lead on public.lead_activities (lead_id, created_at desc);
create index if not exists lead_activities_when on public.lead_activities (created_at);

do $$
declare t text := 'lead_activities';
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

-- every new lead and every stage change is recorded automatically (powers the funnel, speed-to-close and timeline)
create or replace function public.trg_lead_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (lead_id, kind, body, to_stage, created_by) values (new.id, 'Created', coalesce('Source: ' || new.source, 'Lead created'), new.stage, auth.uid());
  elsif new.stage is distinct from old.stage then
    insert into public.lead_activities (lead_id, kind, body, from_stage, to_stage, created_by)
    values (new.id, 'Stage', old.stage || ' → ' || new.stage || coalesce(' (' || nullif(new.lost_reason, '') || ')', ''), old.stage, new.stage, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists leads_history on public.leads;
create trigger leads_history after insert or update on public.leads for each row execute function public.trg_lead_history();

-- backfill: give every existing lead a "Created" entry at its creation time
insert into public.lead_activities (lead_id, kind, body, to_stage, created_at)
select l.id, 'Created', coalesce('Source: ' || l.source, 'Lead created'), l.stage, coalesce(l.created_at, now())
from public.leads l where not exists (select 1 from public.lead_activities a where a.lead_id = l.id);
