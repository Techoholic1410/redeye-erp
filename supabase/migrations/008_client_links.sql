-- Client-facing links: approvals (no login), client portal, contracts with e-sign. Safe to re-run.

-- invoice columns used by later migrations / the portal
alter table public.invoices add column if not exists amount_paid numeric not null default 0;
alter table public.invoices add column if not exists gst_mode text;
alter table public.invoices add column if not exists package_id bigint;

alter table public.content_items add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.content_plans add column if not exists share_token uuid not null default gen_random_uuid();
alter table public.clients       add column if not exists portal_token uuid not null default gen_random_uuid();
create unique index if not exists content_items_share_token on public.content_items (share_token);
create unique index if not exists content_plans_share_token on public.content_plans (share_token);
create unique index if not exists clients_portal_token on public.clients (portal_token);

-- ============ contracts ============
create table if not exists public.contracts (
  id bigint generated always as identity primary key,
  client_id bigint references public.clients(id) on delete set null,
  title text not null, body text, status text default 'Draft',
  share_token uuid not null default gen_random_uuid() unique,
  signed_name text, signed_at timestamptz,
  created_by uuid default auth.uid(), created_at timestamptz default now());

create or replace function public.trg_contracts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status = 'Signed' and (new.body is distinct from old.body or new.title is distinct from old.title or new.status is distinct from 'Signed') then
    raise exception 'A signed contract cannot be edited. Create a new one instead.';
  end if;
  return new;
end $$;
drop trigger if exists contracts_guard on public.contracts;
create trigger contracts_guard before update on public.contracts for each row execute function public.trg_contracts();

do $$
declare t text := 'contracts';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t||'_sel', t); execute format('drop policy if exists %I on public.%I', t||'_ins', t);
  execute format('drop policy if exists %I on public.%I', t||'_upd', t); execute format('drop policy if exists %I on public.%I', t||'_del', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.my_role() in (''admin'',''manager''))', t||'_sel', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.my_role() in (''admin'',''manager''))', t||'_ins', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.my_role() in (''admin'',''manager'')) with check (public.my_role() in (''admin'',''manager''))', t||'_upd', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.my_role() = ''admin'' and status <> ''Signed'')', t||'_del', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $$;
grant usage, select on all sequences in schema public to authenticated;

-- ============ public (no-login) functions ============
create or replace function public.public_approval(kind text, tok uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid bigint; plan jsonb; items jsonb; cname text; co jsonb; pid bigint;
begin
  if kind = 'item' then select client_id into cid from public.content_items where share_token = tok;
  elsif kind = 'plan' then select client_id, id into cid, pid from public.content_plans where share_token = tok;
  end if;
  if cid is null then return null; end if;
  select name into cname from public.clients where id = cid;
  select data into co from public.company_profile where id = 1;
  if kind = 'plan' then
    select jsonb_build_object('title', title, 'month', month, 'objective', objective) into plan from public.content_plans where id = pid;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'format', i.format, 'platform', i.platform, 'pillar', i.pillar,
      'publish_date', i.publish_date, 'publish_time', i.publish_time, 'concept', i.concept, 'script', i.script, 'caption', i.caption, 'hashtags', i.hashtags,
      'asset_link', i.asset_link, 'status', i.status, 'client_status', i.client_status, 'client_feedback', i.client_feedback) order by i.publish_date nulls last, i.id), '[]')
    into items from public.content_items i
    where (kind = 'item' and i.share_token = tok) or (kind = 'plan' and i.plan_id = pid);
  return jsonb_build_object('kind', kind, 'client', jsonb_build_object('name', cname), 'company', jsonb_build_object('name', coalesce(co->>'name', 'Redeye Digital Solutions')), 'plan', plan, 'items', items);
end $$;

-- status-change alerts are skipped for client responses (respond_approval sends its own, with the comment)
create or replace function public.trg_content_after() returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); who text := public.uname(auth.uid()); cname text; ttl text; u text := '#/content_items';
begin
  select name into cname from public.clients where id = new.client_id;
  ttl := new.title || coalesce(' · ' || cname, '');
  if new.writer_id   is not null and new.writer_id   is distinct from actor and (tg_op='INSERT' or old.writer_id   is distinct from new.writer_id)   then perform public.notify(array[new.writer_id],   'Script assigned to you', ttl || ' — by ' || who, u); end if;
  if new.editor_id   is not null and new.editor_id   is distinct from actor and (tg_op='INSERT' or old.editor_id   is distinct from new.editor_id)   then perform public.notify(array[new.editor_id],   'Edit assigned to you',   ttl || ' — by ' || who, u); end if;
  if new.designer_id is not null and new.designer_id is distinct from actor and (tg_op='INSERT' or old.designer_id is distinct from new.designer_id) then perform public.notify(array[new.designer_id], 'Design assigned to you', ttl || ' — by ' || who, u); end if;
  if new.owner_id    is not null and new.owner_id    is distinct from actor and (tg_op='INSERT' or old.owner_id    is distinct from new.owner_id)    then perform public.notify(array[new.owner_id],    'Content assigned to you', ttl || ' — by ' || who, u); end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status and coalesce(current_setting('app.skip_status_notify', true), '') <> '1' then
    if new.status = 'Ready to shoot' then perform public.notify(array_remove(array[new.owner_id], actor), 'Ready to shoot', ttl, u);
    elsif new.status = 'Shot' then perform public.notify(array_remove(array[new.editor_id], actor), 'Footage ready to edit', ttl, u);
    elsif new.status = 'Internal review' then perform public.notify(array_remove(public.role_ids('{admin,manager}') || array[new.owner_id], actor), 'Ready for internal review', ttl || ' — by ' || who, u);
    elsif new.status = 'Changes needed' then perform public.notify(array_remove(array[new.editor_id, new.designer_id, new.writer_id, new.owner_id], actor), 'Changes requested', ttl, u);
    elsif new.status = 'Approved' then perform public.notify(array_remove(array[new.owner_id, new.editor_id, new.designer_id], actor), 'Approved — ready to schedule', ttl, u);
    elsif new.status = 'Published' then perform public.notify(array_remove(array[new.owner_id], actor), 'Published', ttl, u);
    end if;
  end if;
  return new;
end $$;

create or replace function public.respond_approval(kind text, tok uuid, item_id bigint, decision text, who text, comment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it public.content_items; ns text; cname text; msg text; stamp text; who2 text := left(coalesce(nullif(btrim(who), ''), 'Client'), 80); cm text := left(btrim(coalesce(comment, '')), 2000);
begin
  if kind = 'item' then select * into it from public.content_items where id = item_id and share_token = tok;
  elsif kind = 'plan' then select i.* into it from public.content_items i join public.content_plans p on p.id = i.plan_id where i.id = item_id and p.share_token = tok;
  end if;
  if it.id is null then raise exception 'This link is not valid'; end if;
  if decision not in ('approve', 'changes') then raise exception 'Invalid choice'; end if;
  if decision = 'changes' and cm = '' then raise exception 'Please tell us what to change'; end if;
  ns := it.status;
  if decision = 'approve' and it.status in ('Client review', 'Changes needed', 'Internal review') then ns := 'Approved';
  elsif decision = 'changes' and it.status in ('Client review', 'Approved', 'Scheduled') then ns := 'Changes needed'; end if;
  stamp := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH24:MI');
  perform set_config('app.skip_status_notify', '1', true);
  update public.content_items set status = ns,
    client_status = case decision when 'approve' then 'Approved' else 'Changes requested' end,
    client_feedback = case when cm = '' then client_feedback else coalesce(client_feedback || E'\n', '') || '[' || stamp || ' ' || who2 || '] ' || cm end
    where id = it.id;
  select name into cname from public.clients where id = it.client_id;
  msg := who2 || case decision when 'approve' then ' approved ' else ' requested changes on ' end || it.title || coalesce(' (' || cname || ')', '') || case when cm = '' then '' else ': ' || left(cm, 200) end;
  perform public.notify(public.role_ids('{admin,manager}') || array[it.owner_id, it.editor_id, it.designer_id, it.writer_id],
    case decision when 'approve' then '✅ Client approved' else '✏️ Client wants changes' end, msg, '#/content_items');
  return jsonb_build_object('ok', true, 'status', ns);
end $$;

create or replace function public.public_portal(tok uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cl public.clients; co jsonb;
begin
  select * into cl from public.clients where portal_token = tok;
  if cl.id is null then return null; end if;
  select data into co from public.company_profile where id = 1;
  return jsonb_build_object(
    'client', jsonb_build_object('name', cl.name),
    'company', jsonb_build_object('name', coalesce(co->>'name', 'Redeye Digital Solutions'), 'email', co->>'email', 'phone', co->>'phone', 'tagline', co->>'tagline'),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'format', i.format, 'platform', i.platform, 'publish_date', i.publish_date, 'status', i.status, 'client_status', i.client_status, 'share_token', i.share_token) order by i.publish_date nulls last)
        from public.content_items i where i.client_id = cl.id and i.status <> 'Published' and (i.publish_date is null or i.publish_date >= current_date - 7)), '[]'),
    'published', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'format', i.format, 'platform', i.platform, 'date', coalesce(i.posted_on, i.publish_date), 'url', i.posted_url, 'views', i.views, 'reach', i.reach, 'likes', i.likes, 'comments', i.comments, 'shares', i.shares) order by coalesce(i.posted_on, i.publish_date) desc)
        from public.content_items i where i.client_id = cl.id and i.status = 'Published' and coalesce(i.posted_on, i.publish_date) >= current_date - 45), '[]'),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', v.number, 'issue_date', v.issue_date, 'due_date', v.due_date, 'total', v.total, 'amount_paid', v.amount_paid, 'status', v.status, 'share_token', v.share_token) order by v.issue_date desc)
        from (select * from public.invoices where client_id = cl.id and status not in ('Draft', 'Cancelled') order by issue_date desc limit 12) v), '[]'),
    'shoots', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'date', s.shoot_date, 'call_time', s.call_time, 'location', s.location, 'status', s.status) order by s.shoot_date)
        from public.shoots s where s.client_id = cl.id and s.shoot_date >= current_date and s.status <> 'Cancelled'), '[]'),
    'package', (select jsonb_build_object('name', p.name, 'videos', p.videos_per_month, 'posts', p.posts_per_month) from public.packages p where p.client_id = cl.id and p.status = 'Active' order by p.id desc limit 1));
end $$;

create or replace function public.public_contract(tok uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k public.contracts; co jsonb; cname text;
begin
  select * into k from public.contracts where share_token = tok;
  if k.id is null then return null; end if;
  select name into cname from public.clients where id = k.client_id;
  select data into co from public.company_profile where id = 1;
  return jsonb_build_object('contract', jsonb_build_object('title', k.title, 'body', k.body, 'status', k.status, 'signed_name', k.signed_name, 'signed_at', k.signed_at),
    'client', jsonb_build_object('name', cname), 'company', jsonb_build_object('name', coalesce(co->>'name', 'Redeye Digital Solutions')));
end $$;

create or replace function public.sign_contract(tok uuid, who text) returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.contracts; nm text := left(btrim(coalesce(who, '')), 120);
begin
  select * into k from public.contracts where share_token = tok;
  if k.id is null then raise exception 'This link is not valid'; end if;
  if k.status = 'Signed' then raise exception 'Already signed'; end if;
  if k.status not in ('Draft', 'Sent') then raise exception 'This contract is not open for signing'; end if;
  if length(nm) < 3 then raise exception 'Please type your full name'; end if;
  update public.contracts set status = 'Signed', signed_name = nm, signed_at = now() where id = k.id;
  perform public.notify(public.role_ids('{admin,manager}'), '✍️ Contract signed', k.title || ' — signed by ' || nm, '#/contracts');
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.public_approval(text, uuid), public.respond_approval(text, uuid, bigint, text, text, text), public.public_portal(uuid), public.public_contract(uuid), public.sign_contract(uuid, text) from public;
grant execute on function public.public_approval(text, uuid), public.respond_approval(text, uuid, bigint, text, text, text), public.public_portal(uuid), public.public_contract(uuid), public.sign_contract(uuid, text) to anon, authenticated;
