-- Timely task reminders: due time, per-task reminder timing, daily overdue nudges, remind-now and snooze. Run after 012. Safe to re-run.
alter table public.tasks add column if not exists due_time text;                    -- HH:MM (India time), optional
alter table public.tasks add column if not exists remind text default 'None';       -- when to remind the assignee
alter table public.tasks add column if not exists nag_overdue text default 'Yes';   -- nudge daily while overdue
alter table public.tasks add column if not exists remind_at timestamptz;
alter table public.tasks add column if not exists reminded_at timestamptz;

-- work out when the reminder should fire; recompute only when the due date/time or reminder setting changes (so snooze can move it)
create or replace function public.trg_tasks_remind() returns trigger language plpgsql security definer set search_path = public as $$
declare base timestamptz;
begin
  if tg_op = 'INSERT' or (new.due_date, new.due_time, new.remind) is distinct from (old.due_date, old.due_time, old.remind) then
    if new.due_date is null or coalesce(new.remind, 'None') = 'None' then
      new.remind_at := null;
    else
      base := ((new.due_date::text || ' ' || coalesce(nullif(new.due_time, ''), '09:00'))::timestamp) at time zone 'Asia/Kolkata';
      new.remind_at := case new.remind
        when 'At due time' then base
        when '15 minutes before' then base - interval '15 minutes'
        when '1 hour before' then base - interval '1 hour'
        when '3 hours before' then base - interval '3 hours'
        when '1 day before' then base - interval '1 day'
        when 'Morning of due date' then ((new.due_date::text || ' 09:00')::timestamp) at time zone 'Asia/Kolkata'
        else null end;
    end if;
    new.reminded_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_remind on public.tasks;
create trigger tasks_remind before insert or update on public.tasks for each row execute function public.trg_tasks_remind();
update public.tasks set remind = 'None' where remind is null;

-- every 5 minutes: send due reminders; at 10:00 India time nudge overdue tasks (managers hear about 3+ days late)
create or replace function public.run_task_reminders() returns int language plpgsql security definer set search_path = public as $$
declare t record; n int := 0; ist_today date := (now() at time zone 'Asia/Kolkata')::date; h int := extract(hour from (now() at time zone 'Asia/Kolkata'))::int; late int;
begin
  for t in select * from public.tasks where status <> 'Done' and assignee_id is not null and remind_at is not null and remind_at <= now() and remind_at > now() - interval '2 days' and reminded_at is null loop
    update public.tasks set reminded_at = now() where id = t.id;
    perform public.notify(array[t.assignee_id], '⏰ ' || t.title,
      case when t.due_date = ist_today then 'Due today' || coalesce(' at ' || nullif(t.due_time, ''), '') when t.due_date = ist_today + 1 then 'Due tomorrow' || coalesce(' at ' || nullif(t.due_time, ''), '')
           when t.due_date < ist_today then 'Overdue' else 'Due ' || to_char(t.due_date, 'DD Mon') end, '#/tasks');
    n := n + 1;
  end loop;
  if h = 10 then
    for t in select * from public.tasks where status <> 'Done' and assignee_id is not null and due_date < ist_today and coalesce(nag_overdue, 'Yes') = 'Yes' loop
      late := ist_today - t.due_date;
      begin
        insert into public.reminders (key) values ('nag:' || t.id || ':' || ist_today);
        perform public.notify(array[t.assignee_id], '⚠️ Overdue by ' || late || ' day' || case when late > 1 then 's' else '' end, t.title, '#/tasks');
        n := n + 1;
        if late = 3 then perform public.notify(public.role_ids('{admin,manager}'), 'Task 3 days overdue', t.title || ' — ' || public.uname(t.assignee_id), '#/tasks'); end if;
      exception when unique_violation then null;
      end;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.run_task_reminders() from public, anon, authenticated;

-- "Remind now": managers (or whoever created the task) nudge the assignee
create or replace function public.remind_task(tid bigint, note text default null) returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  if public.my_role() is null then raise exception 'Not allowed'; end if;
  select * into t from public.tasks where id = tid;
  if t.id is null then raise exception 'Task not found'; end if;
  if t.assignee_id is null then raise exception 'This task has no assignee yet'; end if;
  if public.my_role() = 'staff' and t.created_by is distinct from auth.uid() then raise exception 'Only managers or the task creator can send reminders'; end if;
  perform public.notify(array[t.assignee_id], '🔔 ' || public.uname(auth.uid()) || ' reminded you', t.title || coalesce(' — ' || nullif(btrim(note), ''), ''), '#/tasks');
end $$;
-- "Snooze": the assignee pushes their reminder back
create or replace function public.snooze_task(tid bigint, mins int) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Not allowed'; end if;
  if mins < 5 or mins > 4320 then raise exception 'Choose between 5 minutes and 3 days'; end if;
  update public.tasks set remind_at = now() + make_interval(mins => mins), reminded_at = null where id = tid and assignee_id = auth.uid();
  if not found then raise exception 'Only the person assigned can snooze this reminder'; end if;
end $$;
revoke all on function public.remind_task(bigint, text), public.snooze_task(bigint, int) from public, anon;
grant execute on function public.remind_task(bigint, text), public.snooze_task(bigint, int) to authenticated;

-- run the reminder check every 5 minutes
do $$ begin
  perform cron.schedule('erp-task-reminders', '*/5 * * * *', 'select public.run_task_reminders()');
exception when others then raise notice 'pg_cron: %', sqlerrm; end $$;

-- hourly sweep: skip the old once-a-day task reminder for tasks that have their own reminder setting
create or replace function public.run_sweep() returns void language plpgsql security definer set search_path = public as $$
declare i record; t record; s record; c record; e record; crew uuid[]; u uuid; msg text; n_od int; n_cl int; n_post int; n_shoot int; n_appr int; n_task int;
begin
  for i in update public.invoices set status = 'Overdue' where status in ('Sent', 'Partial') and due_date < current_date returning number, total, amount_paid loop
    perform public.notify(public.role_ids('{admin,manager}'), 'Invoice overdue', i.number || ' — balance ' || (i.total - i.amount_paid), '#/invoices');
  end loop;
  perform public.raise_retainer_invoices();
  for t in select * from public.tasks where status <> 'Done' and assignee_id is not null and coalesce(remind, 'None') = 'None' and due_date in (current_date, current_date + 1) loop
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
  -- 9 AM India time: one morning summary per manager/admin (only if something needs them)
  if extract(hour from (now() at time zone 'Asia/Kolkata'))::int = 9 then
    select count(*) into n_od from public.invoices where status in ('Sent', 'Partial', 'Overdue') and due_date < current_date and total - amount_paid > 0;
    select count(*) into n_cl from public.payment_requests where status = 'Paid claimed';
    select count(*) into n_post from public.content_items where status <> 'Published' and publish_date <= current_date;
    select count(*) into n_shoot from public.shoots where status in ('Planned', 'Confirmed') and shoot_date = current_date;
    select count(*) into n_appr from public.content_items where client_status = 'Sent to client' and status <> 'Published';
    for u in select unnest(public.role_ids('{admin,manager}')) loop
      select count(*) into n_task from public.tasks where assignee_id = u and status <> 'Done' and due_date <= current_date;
      msg := concat_ws(' · ',
        case when n_cl > 0 then n_cl || ' payment(s) to confirm' end,
        case when n_od > 0 then n_od || ' overdue invoice(s)' end,
        case when n_post > 0 then n_post || ' post(s) due' end,
        case when n_shoot > 0 then n_shoot || ' shoot(s) today' end,
        case when n_appr > 0 then n_appr || ' waiting on client approval' end,
        case when n_task > 0 then n_task || ' task(s) of yours due' end);
      if msg is not null and msg <> '' then
        begin
          insert into public.reminders (key) values ('digest:' || current_date || ':' || u);
          perform public.notify(array[u], '☀️ Good morning — your day', msg, '#/tower');
        exception when unique_violation then null;
        end;
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.run_sweep() from public, anon, authenticated;
