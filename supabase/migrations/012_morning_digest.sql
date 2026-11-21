-- Morning summary push (9 AM India time) added to the hourly sweep. Run after 011. Safe to re-run.
create or replace function public.run_sweep() returns void language plpgsql security definer set search_path = public as $$
declare i record; t record; s record; c record; e record; crew uuid[]; u uuid; msg text; n_od int; n_cl int; n_post int; n_shoot int; n_appr int; n_task int;
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
