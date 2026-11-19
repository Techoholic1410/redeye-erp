// Data layer: talks straight to Supabase (Auth + Postgres + RPC + Edge Functions).
// Exposes api(path, opts) with the same shape the UI was built against. Security is enforced
// by Postgres row-level security, NOT by this file — hiding things in the UI is only cosmetic.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { ENTITIES, NAV } from './entities.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT');
export const sb = createClient(configured ? SUPABASE_URL : 'https://placeholder.supabase.co', configured ? SUPABASE_ANON_KEY : 'placeholder');

const table = (k) => (k === 'users' ? 'profiles' : k);
const fail = (error) => {
  const m = error.message || String(error);
  if (error.status === 401 || /JWT/i.test(m)) { sb.auth.signOut(); throw new Error('Session expired. Please sign in again.'); }
  if (error.code === '42501' || /row-level security|permission denied/i.test(m)) throw new Error('Not allowed');
  if (error.code === '23505') throw new Error('That already exists');
  if (error.code === '23502') throw new Error('A required field is missing');
  if (error.code === '23503') throw new Error('This record is used elsewhere, so it can’t be deleted');
  if (error.code === '23514') throw new Error('One of the values is not allowed');
  throw new Error(m);
};
const ok = ({ data, error }) => { if (error) fail(error); return data; };
const csvEsc = (v) => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

async function me() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data: p } = await sb.from('profiles').select('id,name,email,role,active').eq('id', user.id).maybeSingle();
  if (!p || p.active !== 'Yes') { await sb.auth.signOut(); throw new Error('Your account is not active yet. Ask an administrator to activate it.'); }
  return p;
}

function toRow(key, row) {
  if (row && typeof row.items !== 'string' && row.items != null) row.items = JSON.stringify(row.items);
  return row;
}
function payload(key, body, isNew) {
  const o = {};
  for (const f of ENTITIES[key].fields) {
    if (f.virtual || f.auto || f.ro || !(f.k in body)) continue;
    let v = body[f.k];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (f.t === 'number' || f.t === 'money') { v = Number(v); if (!Number.isFinite(v)) throw new Error(`${f.l} must be a number`); }
      else if (f.t === 'ref' && f.to !== 'users') v = Number(v);
      else if (f.t === 'items') v = typeof v === 'string' ? JSON.parse(v) : v;
    }
    if (f.req && v === null) throw new Error(`${f.l} is required`);
    if (isNew && v === null) continue;            // let the database default apply
    o[f.k] = v;
  }
  return o;
}
async function adminFn(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}

export async function api(path, opts = {}) {
  const method = opts.method || 'GET', body = opts.body || {};
  let m;

  if (path === '/login') {
    const { error } = await sb.auth.signInWithPassword({ email: String(body.email).trim(), password: body.password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
    return {};
  }
  if (path === '/logout') { await sb.auth.signOut(); return {}; }

  if (path === '/meta') {
    const user = await me(), entities = {};
    for (const k of NAV) {
      const e = ENTITIES[k];
      if (!e.perms.read.includes(user.role)) continue;
      entities[k] = {
        label: e.label, icon: e.icon, labelField: e.labelField, board: e.board, cols: e.cols, fields: e.fields,
        can: Object.fromEntries(['create', 'update', 'del'].map((p) => [p, e.perms[p].includes(user.role)])),
      };
    }
    return { user, entities };
  }

  if (path === '/me/password') {
    const { data: { user } } = await sb.auth.getUser();
    if (String(body.next || '').length < 8) throw new Error('New password must be at least 8 characters');
    const chk = await sb.auth.signInWithPassword({ email: user.email, password: String(body.current || '') });
    if (chk.error) throw new Error('Current password is wrong');
    const { error } = await sb.auth.updateUser({ password: body.next });
    if (error) throw new Error(error.message);
    return {};
  }

  if ((m = path.match(/^\/lookup\/(\w+)$/))) {
    const t = { users: ['profiles', "active.eq.Yes"], clients: ['clients'], projects: ['projects'] }[m[1]];
    if (!t) throw new Error('Unknown lookup');
    let qb = sb.from(t[0]).select('id,label:name').order('name');
    if (m[1] === 'users') qb = qb.eq('active', 'Yes');
    return ok(await qb);
  }

  if ((m = path.match(/^\/e\/(\w+)\/export$/))) {
    const key = m[1], fields = ENTITIES[key].fields.filter((f) => f.t !== 'items' && !f.virtual);
    const rows = ok(await sb.from(table(key)).select('*').order('created_at', { ascending: false }).limit(10000));
    return [fields.map((f) => csvEsc(f.l)).join(','), ...rows.map((r) => fields.map((f) => csvEsc(r[f.k])).join(','))].join('\n');
  }

  if ((m = path.match(/^\/e\/(\w+)(?:\/([\w-]+))?(?:\?(.*))?$/))) {
    const key = m[1], id = m[2], qs = new URLSearchParams(m[3] || ''), e = ENTITIES[key];
    if (!e) throw new Error('Unknown module');
    const t = table(key);
    if (method === 'GET') {
      let qb = sb.from(t).select('*').limit(2000);
      qb = key === 'users' ? qb.order('name') : qb.order('id', { ascending: false });
      const q = (qs.get('q') || '').replace(/[,()%*\\]/g, ' ').trim();
      if (q) qb = qb.or(e.fields.filter((f) => !f.virtual && ['text', 'textarea', 'email', 'tel', 'select'].includes(f.t)).map((f) => `${f.k}.ilike.%${q}%`).join(','));
      return ok(await qb).map((r) => toRow(key, r));
    }
    if (key === 'users') {
      if (method === 'POST') return adminFn({ action: 'create', ...body });
      if (method === 'PUT') return adminFn({ action: 'update', id, name: body.name, email: body.email, role: body.role, active: body.active, password: body.password || undefined });
      if (method === 'DELETE') return adminFn({ action: 'delete', id });
    }
    if (method === 'POST') return toRow(key, ok(await sb.from(t).insert(payload(key, body, true)).select().single()));
    if (method === 'PUT') {
      const rows = ok(await sb.from(t).update(payload(key, body, false)).eq('id', id).select());
      if (!rows.length) throw new Error('Not allowed');
      return toRow(key, rows[0]);
    }
    if (method === 'DELETE') {
      const rows = ok(await sb.from(t).delete().eq('id', id).select());
      if (!rows.length) throw new Error('Not allowed');
      return {};
    }
  }

  if (path === '/attendance/today') return ok(await sb.rpc('attendance_today'));
  if (path === '/attendance/toggle') return ok(await sb.rpc('attendance_toggle'));
  if (path === '/dashboard') return ok(await sb.rpc('dashboard'));

  if (path === '/notifications') {
    const items = ok(await sb.from('notifications').select('*').order('id', { ascending: false }).limit(40));
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false);
    return { items, unread: count || 0 };
  }
  if (path === '/notifications/read') { ok(await sb.from('notifications').update({ read: true }).eq('read', false)); return {}; }
  if (path === '/push/key') return { key: VAPID_PUBLIC_KEY };
  if (path === '/push/subscribe') { ok(await sb.rpc('save_push_sub', { sub: body.subscription })); return {}; }
  if (path === '/push/test') { ok(await sb.rpc('send_test_notification')); return {}; }

  throw new Error('Unknown request: ' + path);
}
