-- Marketing: richer leads (CSV import, outreach tracking) and daily follow-up reminders. Run after 013. Safe to re-run.
alter table public.leads add column if not exists instagram text;
alter table public.leads add column if not exists website text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists campaign text;
alter table public.leads add column if not exists interest text;          -- service they asked about
alter table public.leads add column if not exists next_followup date;
alter table public.leads add column if not exists last_contact date;
alter table public.leads add column if not exists tags text;
create index if not exists leads_followup on public.leads (next_followup) where stage not in ('Won', 'Lost');

-- every morning (10:00 India time): tell each owner which leads need a follow-up today or are overdue
create or replace function public.run_lead_followups() returns int language plpgsql security definer set search_path = public as $$
declare l record; n int := 0; ist_today date := (now() at time zone 'Asia/Kolkata')::date; unowned int;
begin
  for l in select * from public.leads where next_followup <= ist_today and stage not in ('Won', 'Lost') and owner_id is not null loop
    begin
      insert into public.reminders (key) values ('lead:' || l.id || ':' || ist_today);
      perform public.notify(array[l.owner_id], '📞 Follow up: ' || l.name,
        coalesce(l.company || ' · ', '') || coalesce(l.phone, l.email, '') || case when l.next_followup < ist_today then ' · ' || (ist_today - l.next_followup) || ' day(s) late' else '' end, '#/leads');
      n := n + 1;
    exception when unique_violation then null;
    end;
  end loop;
  select count(*) into unowned from public.leads where next_followup <= ist_today and stage not in ('Won', 'Lost') and owner_id is null;
  if unowned > 0 then
    begin
      insert into public.reminders (key) values ('lead-unowned:' || ist_today);
      perform public.notify(public.role_ids('{admin,manager}'), '📞 Leads with no owner', unowned || ' lead(s) are due for follow-up but nobody owns them', '#/leads');
    exception when unique_violation then null;
    end;
  end if;
  return n;
end $$;
revoke all on function public.run_lead_followups() from public, anon, authenticated;

do $$ begin
  perform cron.schedule('erp-lead-followups', '30 4 * * *', 'select public.run_lead_followups()');   -- 04:30 UTC = 10:00 IST
exception when others then raise notice 'pg_cron: %', sqlerrm; end $$;
