-- Task alerts for assignees (each becomes an in-app notification AND a push to every browser/device the person enabled).
create or replace function public.trg_tasks_after() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); who text := public.uname(auth.uid()); changes text[] := '{}';
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null and new.assignee_id is distinct from actor then
      perform public.notify(array[new.assignee_id], 'New task assigned', new.title || ' — by ' || who, '#/tasks'); end if;
    return new;
  end if;
  -- reassigned: tell the new assignee, and the previous one that it moved
  if old.assignee_id is distinct from new.assignee_id then
    if new.assignee_id is not null and new.assignee_id is distinct from actor then
      perform public.notify(array[new.assignee_id], 'New task assigned', new.title || ' — by ' || who, '#/tasks'); end if;
    if old.assignee_id is not null and old.assignee_id is distinct from actor then
      perform public.notify(array[old.assignee_id], 'Task reassigned', new.title || ' was moved to someone else', '#/tasks'); end if;
  end if;
  -- changes made by someone else to a task you own
  if new.assignee_id is not null and new.assignee_id is not distinct from old.assignee_id and new.assignee_id is distinct from actor then
    if old.status   is distinct from new.status   then changes := changes || ('status → ' || coalesce(new.status,'-')); end if;
    if old.due_date is distinct from new.due_date then changes := changes || ('due date → ' || coalesce(new.due_date::text,'none')); end if;
    if old.priority is distinct from new.priority then changes := changes || ('priority → ' || coalesce(new.priority,'-')); end if;
    if old.title    is distinct from new.title    then changes := changes || 'title edited'; end if;
    if array_length(changes,1) > 0 then
      perform public.notify(array[new.assignee_id], 'Task updated', new.title || ': ' || array_to_string(changes, ', ') || ' (by ' || who || ')', '#/tasks'); end if;
  end if;
  return new;
end $$;
