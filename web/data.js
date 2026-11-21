// Data layer: talks straight to Supabase (Auth + Postgres + RPC + Edge Functions).
// Exposes api(path, opts) with the same shape the UI was built against. Security is enforced
// by Postgres row-level security, NOT by this file — hiding things in the UI is only cosmetic.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { ENTITIES, NAV, NAV_GROUPS } from './entities.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT');
// "Keep me signed in" (default) stores the session on this device; unticked keeps it only until the tab/window is closed.
const REMEMBER = 'redeye-remember';
const remembering = () => { try { return localStorage.getItem(REMEMBER) !== '0'; } catch { return true; } };
const authStorage = {
  getItem: (k) => { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { (remembering() ? localStorage : sessionStorage).setItem(k, v); (remembering() ? sessionStorage : localStorage).removeItem(k); } catch {} },
  removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};
export const sb = createClient(configured ? SUPABASE_URL : 'https://placeholder.supabase.co', configured ? SUPABASE_ANON_KEY : 'placeholder',
  { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const table = (k) => (k === 'users' ? 'profiles' : k);
let refreshing = null;
const recover = () => (refreshing ||= sb.auth.refreshSession().then(({ error }) => { if (error && /refresh token|invalid|not found|expired/i.test(error.message)) sb.auth.signOut(); }).catch(() => {}).finally(() => { refreshing = null; }));
const fail = (error) => {
  const m = error.message || String(error);
  // A one-off token error must not sign you out: try to refresh quietly; only sign out if the refresh token itself is dead.
  if (error.status === 401 || /JWT/i.test(m)) { recover(); throw new Error('Reconnecting… please try that again.'); }
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
  const { data: { session } } = await sb.auth.getSession();   // local, works offline: no network call just to know who you are
  const user = session?.user;
  if (!user) throw new Error('Not signed in');
  const { data: p, error } = await sb.from('profiles').select('id,name,email,role,active').eq('id', user.id).maybeSingle();
  if (error) {
    if (error.status === 401 || /JWT/i.test(error.message || '')) { await recover(); throw new Error('Reconnecting… please reload in a moment.'); }
    throw new Error('Could not reach the server. Check your connection and try again.');   // keeps you signed in
  }
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
      else if (f.t === 'items' || f.t === 'deductions' || f.t === 'multi' || f.t === 'cadence' || f.t === 'checklist') v = typeof v === 'string' ? JSON.parse(v) : v;
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
    try { localStorage.setItem(REMEMBER, body.remember ? '1' : '0'); } catch {}
    const { error } = await sb.auth.signInWithPassword({ email: String(body.email).trim(), password: body.password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
    return {};
  }
  if (path === '/logout') { await sb.auth.signOut(); return {}; }
  if (path === '/public/doc') return ok(await sb.rpc('public_doc', { kind: body.kind, tok: body.token }));

  if (path === '/meta') {
    const user = await me(), entities = {};
    for (const k of NAV) {
      const e = ENTITIES[k];
      if (!e.perms.read.includes(user.role)) continue;
      entities[k] = {
        label: e.label, icon: e.icon, labelField: e.labelField, board: e.board, cols: e.cols, fields: e.fields,
        calendar: e.calendar, filters: e.filters, actions: e.actions, defaultMode: e.defaultMode,
        can: Object.fromEntries(['create', 'update', 'del'].map((p) => [p, e.perms[p].includes(user.role)])),
      };
    }
    const groups = NAV_GROUPS.map(([g, ks]) => [g, ks.filter((k) => entities[k])]).filter(([, ks]) => ks.length);
    return { user, entities, groups };
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
    const col = { users: 'name', clients: 'name', projects: 'name', assets: 'name', leads: 'name', content_plans: 'title', shoots: 'title', invoices: 'number', freelancers: 'name' }[m[1]];
    if (!col) throw new Error('Unknown lookup');
    const t = [m[1] === 'users' ? 'profiles' : m[1]];
    let qb = sb.from(t[0]).select(`id,label:${col}`).order(col);
    if (m[1] === 'users') qb = qb.eq('active', 'Yes');
    return ok(await qb);
  }

  if ((m = path.match(/^\/e\/(\w+)\/export$/))) {
    const key = m[1], fields = ENTITIES[key].fields.filter((f) => f.k && f.t !== 'items' && f.t !== 'deductions' && f.t !== 'multi' && f.t !== 'cadence' && f.t !== 'checklist' && !f.virtual);
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

  if (path === '/ai') {
    const { data, error } = await sb.functions.invoke('ai-assist', { body });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
    return data;
  }
  if (path === '/company') {
    if (method === 'PUT') { ok(await sb.from('company_profile').upsert({ id: 1, data: body })); return body; }
    const { data } = await sb.from('company_profile').select('data').eq('id', 1).maybeSingle(); return data?.data || {};
  }
  if (path === '/calendar/token') return ok(await sb.rpc('my_calendar_token'));
  if (path === '/public/approval') return ok(await sb.rpc('public_approval', { kind: body.kind, tok: body.token }));
  if (path === '/public/respond') return ok(await sb.rpc('respond_approval', { kind: body.kind, tok: body.token, item_id: body.item_id, decision: body.decision, who: body.who || '', comment: body.comment || '' }));
  if (path === '/tasks/remind') { ok(await sb.rpc('remind_task', { tid: body.id, note: body.note || null })); return {}; }
  if (path === '/tasks/snooze') { ok(await sb.rpc('snooze_task', { tid: body.id, mins: body.mins })); return {}; }
  if (path === '/public/payreq') return ok(await sb.rpc('public_payment_request', { tok: body.token }));
  if (path === '/public/claim') return ok(await sb.rpc('claim_payment_request', { tok: body.token, ref: body.ref, who: body.who || '' }));
  if (path === '/public/portal') return ok(await sb.rpc('public_portal', { tok: body.token }));
  if (path === '/public/contract') return ok(await sb.rpc('public_contract', { tok: body.token }));
  if (path === '/public/sign') return ok(await sb.rpc('sign_contract', { tok: body.token, who: body.who }));

  if (path === '/comments') {
    if (method === 'POST') return ok(await sb.from('comments').insert({ entity: body.entity, record_id: body.record_id, body: body.body, mentions: body.mentions || [] }).select().single());
    return ok(await sb.from('comments').select('*').eq('entity', body.entity).eq('record_id', body.record_id).order('id'));
  }
  if ((m = path.match(/^\/comments\/(\d+)$/)) && method === 'DELETE') { ok(await sb.from('comments').delete().eq('id', m[1])); return {}; }

  if (path === '/attachments') {
    if (method === 'POST') {
      const f = body.file, safe = String(f.name).replace(/[^\w.\-]+/g, '_'), pth = `${body.entity}/${body.record_id}/${Date.now()}-${safe}`;
      const up = await sb.storage.from('files').upload(pth, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) throw new Error(up.error.message);
      return ok(await sb.from('attachments').insert({ entity: body.entity, record_id: body.record_id, name: f.name, path: pth, size: f.size, mime: f.type }).select().single());
    }
    return ok(await sb.from('attachments').select('*').eq('entity', body.entity).eq('record_id', body.record_id).order('id'));
  }
  if (path === '/attachments/url') { const r = await sb.storage.from('files').createSignedUrl(body.path, 3600); if (r.error) throw new Error(r.error.message); return { url: r.data.signedUrl }; }
  if ((m = path.match(/^\/attachments\/(\d+)$/)) && method === 'DELETE') {
    const row = ok(await sb.from('attachments').select('path').eq('id', m[1]).maybeSingle());
    if (row) await sb.storage.from('files').remove([row.path]);
    ok(await sb.from('attachments').delete().eq('id', m[1])); return {};
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
