// Private calendar feed (.ics) for Google / Apple Calendar: shoots, posts, edits due, tasks and meetings.
// URL: /functions/v1/calendar-feed?token=<personal token>[&scope=all]   (get your link in the app: Settings → Calendar feed)
// Deployed WITHOUT JWT verification: the secret token in the URL is the credential.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const esc = (t: unknown) => String(t ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => { const out: string[] = []; let l = line; while (l.length > 73) { out.push(l.slice(0, 73)); l = " " + l.slice(73); } out.push(l); return out.join("\r\n"); };
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const day = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ""); };
// India Standard Time (UTC+05:30) -> UTC
const utc = (date: string, time?: string | null, addMin = 0) => {
  const [h, m] = (time && /^\d{1,2}:\d{2}/.test(time) ? time : "09:00").split(":").map(Number);
  const dt = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m) - 330 * 60000 + addMin * 60000);
  return dt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
};
type Ev = { uid: string; date: string; time?: string | null; endTime?: string | null; mins?: number; title: string; where?: string | null; desc?: string | null };

Deno.serve(async (req) => {
  const url = new URL(req.url), token = url.searchParams.get("token") ?? "", all = url.searchParams.get("scope") === "all";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("Not found", { status: 404 });
  const { data: t } = await sb.from("calendar_tokens").select("user_id").eq("token", token).maybeSingle();
  if (!t) return new Response("Not found", { status: 404 });
  const uid = t.user_id as string, since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  const [shoots, items, tasks, meets, clients] = await Promise.all([
    sb.from("shoots").select("*").gte("shoot_date", since).neq("status", "Cancelled"),
    sb.from("content_items").select("id,title,format,platform,client_id,publish_date,publish_time,edit_due,status,owner_id,writer_id,editor_id,designer_id").or(`publish_date.gte.${since},edit_due.gte.${since}`),
    sb.from("tasks").select("id,title,due_date,status,assignee_id,priority").gte("due_date", since).neq("status", "Done"),
    sb.from("meetings").select("*").gte("meeting_date", since).neq("status", "Cancelled"),
    sb.from("clients").select("id,name"),
  ]);
  const cname = Object.fromEntries((clients.data ?? []).map((c: { id: number; name: string }) => [c.id, c.name]));
  const mine = (ids: (string | null)[]) => all || ids.includes(uid);
  const evs: Ev[] = [];

  for (const s of shoots.data ?? []) {
    const crew: string[] = Array.isArray(s.crew_ids) ? s.crew_ids : [];
    if (!s.shoot_date || !mine([s.director_id, ...crew])) continue;
    evs.push({ uid: `shoot-${s.id}`, date: s.shoot_date, time: s.call_time, endTime: s.wrap_time, mins: 240, title: `🎬 ${s.title}`, where: s.location, desc: [cname[s.client_id], s.shot_list].filter(Boolean).join("\n") });
  }
  for (const i of items.data ?? []) {
    if (!mine([i.owner_id, i.writer_id, i.editor_id, i.designer_id])) continue;
    if (i.publish_date && i.status !== "Published") evs.push({ uid: `post-${i.id}`, date: i.publish_date, time: i.publish_time, mins: 30, title: `📤 Post: ${i.title}`, desc: [cname[i.client_id], i.format, i.platform, i.status].filter(Boolean).join(" · ") });
    if (i.edit_due && i.status !== "Published" && (all || i.editor_id === uid)) evs.push({ uid: `edit-${i.id}`, date: i.edit_due, title: `✂️ Edit due: ${i.title}`, desc: cname[i.client_id] });
  }
  for (const k of tasks.data ?? []) {
    if (!k.due_date || !(all || k.assignee_id === uid)) continue;
    evs.push({ uid: `task-${k.id}`, date: k.due_date, title: `✅ ${k.title}`, desc: k.priority ? `Priority: ${k.priority}` : "" });
  }
  for (const m of meets.data ?? []) {
    if (!m.meeting_date) continue;
    evs.push({ uid: `meet-${m.id}`, date: m.meeting_date, time: m.meeting_time, mins: 60, title: `🤝 ${m.title}`, where: m.location, desc: [cname[m.client_id], m.agenda].filter(Boolean).join("\n") });
  }

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Redeye Digital Solutions//ERP//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Redeye ERP", "X-WR-TIMEZONE:Asia/Kolkata", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const e of evs) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@redeye-erp`, `DTSTAMP:${stamp}`);
    if (e.time) {
      lines.push(`DTSTART:${utc(e.date, e.time)}`);
      lines.push(`DTEND:${e.endTime && /^\d{1,2}:\d{2}/.test(e.endTime) ? utc(e.date, e.endTime) : utc(e.date, e.time, e.mins ?? 60)}`);
    } else { lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`); }
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.where) lines.push(fold(`LOCATION:${esc(e.where)}`));
    if (e.desc) lines.push(fold(`DESCRIPTION:${esc(e.desc)}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" } });
});
