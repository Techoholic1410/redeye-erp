-- Run AFTER 001. Each block is independent and safe to re-run.

-- Live bell updates in the browser (Realtime)
do $$ begin alter publication supabase_realtime add table public.notifications;
exception when others then raise notice 'realtime: %', sqlerrm; end $$;

-- Web push delivery: needs pg_net (Database → Extensions → pg_net)
do $$ begin create extension if not exists pg_net;
exception when others then raise notice 'pg_net: %', sqlerrm; end $$;

-- Hourly reminders: needs pg_cron (Database → Extensions → pg_cron)
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('erp-sweep', '0 * * * *', 'select public.run_sweep()');
exception when others then raise notice 'pg_cron: %', sqlerrm; end $$;
