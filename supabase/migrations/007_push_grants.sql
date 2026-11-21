-- The send-push Edge Function runs as service_role; new Supabase projects don't grant it access to tables we create.
grant usage on schema public to service_role;
grant select, delete on public.push_subs to service_role;
