// Admin-only user management (create / update / delete logins). Uses the service role key,
// which never leaves the server. Caller must be a signed-in active admin.
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });
const ROLES = ["admin", "manager", "staff"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await admin.from("profiles").select("role,active").eq("id", u.user.id).single();
    if (me?.role !== "admin" || me.active !== "Yes") return json({ error: "Admins only" }, 403);

    const b = await req.json();
    const email = String(b.email ?? "").trim().toLowerCase();
    if (b.role && !ROLES.includes(b.role)) return json({ error: "Invalid role" }, 400);
    if (b.password && String(b.password).length < 8) return json({ error: "Password must be at least 8 characters" }, 400);

    if (b.action === "create") {
      if (!email || !b.password || !b.name) return json({ error: "Name, email and password are required" }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { name: b.name } });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ name: b.name, role: b.role ?? "staff", active: b.active ?? "Yes" }).eq("id", data.user.id);
      return json({ id: data.user.id });
    }
    if (b.action === "update") {
      if (b.id === u.user.id && ((b.role && b.role !== "admin") || b.active === "No")) return json({ error: "You can't demote or deactivate yourself" }, 400);
      const patch: Record<string, string> = {};
      for (const k of ["name", "role", "active"]) if (b[k]) patch[k] = b[k];
      if (email) patch.email = email;
      const { error: pe } = await admin.from("profiles").update(patch).eq("id", b.id);
      if (pe) return json({ error: pe.message }, 400);
      const auth: Record<string, string> = {};
      if (email) auth.email = email;
      if (b.password) auth.password = b.password;
      if (Object.keys(auth).length) { const { error } = await admin.auth.admin.updateUserById(b.id, auth); if (error) return json({ error: error.message }, 400); }
      return json({ ok: true });
    }
    if (b.action === "delete") {
      if (b.id === u.user.id) return json({ error: "You can't delete yourself" }, 400);
      const { error } = await admin.auth.admin.deleteUser(b.id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
