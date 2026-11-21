// Claude assistant for the ERP: scripts, captions, content ideas, shot lists, shoot scheduling, free chat.
// Called from the app with the signed-in user's token; only active users may use it.
// Secrets: ANTHROPIC_API_KEY (required), AI_MODEL (optional, default claude-opus-5-5; e.g. claude-sonnet-5-5 is cheaper).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MODEL = Deno.env.get("AI_MODEL") || "claude-opus-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });

const SYSTEM = `You are the creative and planning assistant built into the ERP of Redeye Digital Solutions, a social-media and video-content agency based in Pollachi, Tamil Nadu, India. The team shoots and edits short-form video (reels, YouTube Shorts), carousels and posts for local and regional brands.
Rules: be concrete and ready to use, never generic. Write in English unless the brief asks for Tamil or Tanglish. Respect the client's brand notes. Keep reels short and hook-first. Never invent facts about the client (prices, offers, claims) that are not in the brief - use clear placeholders like [offer] instead. When asked for JSON, output only valid JSON with no commentary.`;

const trim = (v: unknown, n = 4000) => String(v ?? "").slice(0, n);
function pickJson(text: string): unknown {
  const a = Math.min(...["[", "{"].map((c) => (text.indexOf(c) < 0 ? Infinity : text.indexOf(c))));
  const b = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (!isFinite(a) || b < a) throw new Error("The AI reply was not valid JSON - please try again");
  return JSON.parse(text.slice(a, b + 1));
}
const brand = (c: Record<string, unknown> = {}) =>
  `Client: ${trim(c.name, 200)}\nBrand notes: ${trim(c.brand_notes, 1500) || "none"}\nSocial handles: ${trim(c.social_handles, 300) || "n/a"}`;

function buildPrompt(b: Record<string, any>): { prompt: string; json?: boolean; effort: "low" | "medium" } {
  const it = b.item ?? {}, itemLine = `Title: ${trim(it.title, 200)}\nFormat: ${trim(it.format, 60)}\nPlatform: ${trim(it.platform, 60)}\nPillar: ${trim(it.pillar, 120)}\nConcept / hook so far: ${trim(it.concept, 1200) || "none"}`;
  switch (b.task) {
    case "script": {
      const fmt = String(it.format || "");
      const shape = /carousel/i.test(fmt) ? "Give a slide-by-slide carousel: slide 1 = scroll-stopping cover line, then one idea per slide (headline + 1-2 supporting lines), last slide = call to action."
        : /static|poster/i.test(fmt) ? "Give the visual concept, the headline, supporting copy and the call to action."
        : "Give a shoot-ready script: HOOK (first 3 seconds), then a scene table with columns Visual | Voiceover or dialogue | On-screen text, then CTA, music/mood suggestion and a rough total duration. Target " + trim(b.duration, 20) + " seconds if given, otherwise 20-30 seconds.";
      return { prompt: `${brand(b.client)}\n${b.plan ? `Campaign objective: ${trim(b.plan.objective, 600)}\nThemes: ${trim(b.plan.themes, 600)}\n` : ""}\n${itemLine}\nLanguage: ${trim(b.language, 40) || "English"}\n${it.script ? `Existing draft to improve:\n${trim(it.script, 3000)}\n` : ""}${b.notes ? `Extra direction: ${trim(b.notes, 800)}\n` : ""}\nWrite the script now. ${shape}`, effort: "medium" };
    }
    case "caption":
      return { prompt: `${brand(b.client)}\n${itemLine}\n${it.script ? `Script / content:\n${trim(it.script, 2500)}\n` : ""}Language: ${trim(b.language, 40) || "English"}\nWrite the post caption: a first line that survives the "...more" cut, a short body, one clear call to action, and 8-12 relevant hashtags (mix of broad and local). Return JSON exactly like {"caption": "...", "hashtags": "#a #b #c"}.`, json: true, effort: "low" };
    case "ideas": {
      const slots = (b.items ?? []).slice(0, 60).map((s: any) => ({ id: s.id, date: s.publish_date, format: s.format, platform: s.platform, pillar: s.pillar }));
      return { prompt: `${brand(b.client)}\nMonth: ${trim(b.plan?.month, 10)}\nObjective: ${trim(b.plan?.objective, 800)}\nThemes / pillars: ${trim(b.plan?.themes, 800)}\nAlready used titles (do not repeat): ${(b.used ?? []).slice(0, 40).map((t: string) => trim(t, 80)).join(" | ") || "none"}\n\nFill each of these empty calendar slots with a distinct, specific content idea suited to its format, platform and pillar:\n${JSON.stringify(slots)}\n\nReturn a JSON array with one object per slot: {"id": <slot id>, "title": "short working title", "concept": "2-3 sentence concept with the opening hook"}.`, json: true, effort: "medium" };
    }
    case "shotlist": {
      const pcs = (b.pieces ?? []).slice(0, 20).map((p: any, i: number) => `${i + 1}. ${trim(p.title, 150)} [${trim(p.format, 40)}] - ${trim(p.concept, 400)} ${trim(p.script, 700)}`).join("\n");
      return { prompt: `${brand(b.client)}\nShoot: ${trim(b.shoot?.title, 200)}\nLocation: ${trim(b.shoot?.location, 200) || "TBC"}\nCall ${trim(b.shoot?.call_time, 10) || "?"} to wrap ${trim(b.shoot?.wrap_time, 10) || "?"}\nTalent: ${trim(b.shoot?.talent, 400) || "none"}\nProps: ${trim(b.shoot?.props, 400) || "none"}\n\nContent pieces to capture:\n${pcs || "(none attached)"}\n\nWrite an efficient shot list ordered to minimise setup changes (group by location/setup/lighting, indoor/outdoor). For each shot: number, setup, what to capture, and which piece(s) it serves. End with a short equipment and time-plan checklist.`, effort: "medium" };
    }
    case "shoot_plan": {
      const items = (b.items ?? []).slice(0, 80).map((s: any) => ({ id: s.id, client_id: s.client_id, client: s.client, title: s.title, format: s.format, publish_date: s.publish_date, status: s.status }));
      return { prompt: `Today is ${trim(b.today, 10)}. Plan shoot days for content that has not been shot yet.\nRules: batch pieces of the same client into one shoot day where sensible (max ${Number(b.max_per_shoot) || 6} pieces per day); every shoot must be at least ${Number(b.lead_days) || 5} days before the earliest publish date of its pieces (never in the past, never earlier than tomorrow); avoid Sundays; do not use these already-booked dates for the same client: ${JSON.stringify(b.booked ?? [])}; prefer morning call times (09:00-10:30) unless the format suggests otherwise; pieces with no publish date go in the last batch of their client.\n\nUnshot content:\n${JSON.stringify(items)}\n\nReturn a JSON array of shoots: {"title": "Client - short description", "client_id": <number>, "date": "YYYY-MM-DD", "call_time": "HH:MM", "item_ids": [<ids>], "reason": "one short sentence"}. Every unshot piece must appear in exactly one shoot.`, json: true, effort: "medium" };
    }
    default:
      return { prompt: "", effort: "medium" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await admin.from("profiles").select("active").eq("id", u.user.id).single();
    if (me?.active !== "Yes") return json({ error: "Your account is not active" }, 403);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Claude is not connected yet: add the ANTHROPIC_API_KEY secret in Supabase" }, 503);

    const raw = await req.text();
    if (raw.length > 120_000) return json({ error: "Request too large" }, 413);
    const b = JSON.parse(raw);
    const claude = new Anthropic({ apiKey: key });

    let system = SYSTEM, messages: { role: "user" | "assistant"; content: string }[], wantJson = false, effort: "low" | "medium" = "medium", maxTokens = 6000;
    if (b.task === "chat") {
      messages = (b.messages ?? []).slice(-20).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: trim(m.content, 6000) })) as typeof messages;
      if (!messages.length || messages[0].role !== "user") return json({ error: "Send a message first" }, 400);
      if (b.context) system += `\n\nContext from the ERP (use it, do not repeat it back):\n${trim(b.context, 12000)}`;
      maxTokens = 4000;
    } else {
      const p = buildPrompt(b);
      if (!p.prompt) return json({ error: "Unknown task" }, 400);
      messages = [{ role: "user", content: p.prompt }]; wantJson = !!p.json; effort = p.effort; if (b.task === "caption") maxTokens = 2000;
    }

    const res = await claude.messages.create({ model: MODEL, max_tokens: maxTokens, system, messages, output_config: { effort } });
    if (res.stop_reason === "refusal") return json({ error: "Claude declined this request. Try rephrasing the brief." }, 422);
    const text = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n").trim();
    if (!wantJson) return json({ text, usage: res.usage });
    return json({ data: pickJson(text), text, usage: res.usage });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) return json({ error: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Supabase." }, 502);
    if (err.status === 429) return json({ error: "Claude is busy or the API credit is used up. Try again shortly." }, 429);
    if (err.status === 400 && /credit|billing/i.test(err.message ?? "")) return json({ error: "The Anthropic account has no credit. Add credit in the Anthropic console." }, 402);
    return json({ error: err.message ?? "Something went wrong" }, 500);
  }
});
