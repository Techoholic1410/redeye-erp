// Sends a web-push message for each new row in public.notifications.
// Called by the DB trigger (pg_net) with header x-webhook-secret.
// Secrets needed: WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@domain)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) return new Response("forbidden", { status: 403 });
  const { record } = await req.json();
  if (!record?.user_id) return new Response("bad request", { status: 400 });
  const { data: subs } = await sb.from("push_subs").select("id,data").eq("user_id", record.user_id);
  const payload = JSON.stringify({ title: record.title, body: record.body, url: record.url });
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try { await webpush.sendNotification(s.data, payload); sent++; }
    catch (e) { if ([404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) await sb.from("push_subs").delete().eq("id", s.id); }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { "content-type": "application/json" } });
});
