const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = 'INR', LOCALE = 'en-IN';
const money = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 }).format(n || 0);
const money2 = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(n || 0);
const today = () => new Date().toISOString().slice(0, 10);

import './glass.js';
import { api, sb, configured } from './data.js';
import { SUPABASE_URL } from './config.js';
import { CUSTOM_PAGES } from './entities.js';

let meta = null, lookups = {}, notifTimer = null, installEvt = null, notifChannel = null;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = 'none'), 3000); }
function logoutLocal(msg = '') {
  meta = null; clearInterval(notifTimer);
  if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
  renderLogin(msg);
}
let recovering = /type=recovery/.test(location.hash);
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { recovering = true; renderSetPassword(); }
  if (event === 'SIGNED_OUT' && meta) logoutLocal();
});
function renderSetPassword() {
  $('#root').innerHTML = `<div class="login"><form class="card" id="pf">
    <img class="logo" src="icons/logo.png" alt="Redeye Digital Solutions"><h1>Set your password</h1><p>Choose a new password to finish signing in</p>
    <div class="f"><label>New password (8+ characters)</label><input name="p1" type="password" autocomplete="new-password" minlength="8" required autofocus></div>
    <div class="f"><label>Repeat password</label><input name="p2" type="password" autocomplete="new-password" minlength="8" required></div>
    <div class="err" id="pe"></div><button class="btn" style="width:100%">Save password</button></form></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.p1 !== f.p2) { $('#pe').textContent = 'Passwords do not match'; return; }
    const { error } = await sb.auth.updateUser({ password: f.p1 });
    if (error) { $('#pe').textContent = error.message; return; }
    recovering = false; history.replaceState(null, '', location.pathname);
    try { await boot(); } catch (err) { logoutLocal(err.message); }
  };
}

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'refresh-notifications') loadNotifs(); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (meta) route(); });

// ---------- login ----------
function renderLogin(msg = '') {
  $('#root').innerHTML = `<div class="login"><form class="card" id="lf">
    <img class="logo" src="icons/logo.png" alt="Redeye Digital Solutions"><h1>Redeye ERP</h1><p>Redeye Digital Solutions · sign in to continue</p>
    <div class="f"><label>Email</label><input name="email" type="email" autocomplete="username" required autofocus></div>
    <div class="f"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink);margin:2px 0 8px"><input type="checkbox" name="remember" checked style="width:auto"> Keep me signed in on this device</label>
    <div class="err" id="le">${esc(msg)}</div><button class="btn" style="width:100%">Sign in</button></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/login', { method: 'POST', body: f }); await boot(); }
    catch (err) { $('#le').textContent = err.message; }
  };
}

// ---------- shell ----------
async function boot() {
  meta = await api('/meta');
  lookups = {};
  $('#root').innerHTML = `<div class="shell">
    <aside class="side" id="side"><div class="brand"><img src="icons/logo.png" alt="Redeye"><small>ERP</small></div>
      <nav class="nav" id="nav"></nav>
      <div class="me"><b>${esc(meta.user.name)}</b>${esc(meta.user.role)} · <a href="#" id="lo" style="color:var(--brand)">Sign out</a></div></aside>
    <div class="main"><div class="top"><button class="iconbtn burger" id="bg" aria-label="Menu">☰</button><h2 id="title"></h2>
      <button class="iconbtn" id="bell" aria-label="Notifications">🔔<span class="badge" id="bb" hidden>0</span></button></div>
      <div id="view"></div></div></div>`;
  const link = (k, i, l) => `<a href="#/${k}" data-k="${k}"><span>${i}</span>${esc(l)}</a>`;
  $('#nav').innerHTML = link('dashboard', '📊', 'Dashboard') + link('tower', '🚦', 'Control tower') + meta.groups.map(([g, ks]) => `<div class="grp">${esc(g)}</div>` + ks.map((k) => link(k, meta.entities[k].icon, meta.entities[k].label)).join('') + CUSTOM_PAGES.filter((c) => c.group === g && c.roles.includes(meta.user.role)).map((c) => link(c.k, c.icon, c.label)).join('')).join('') + '<div class="grp">Account</div>' + link('assistant', '✨', 'Ask Claude') + link('settings', '⚙️', 'Settings');
  $('#lo').onclick = async (e) => { e.preventDefault(); try { await api('/logout', { method: 'POST' }); } catch {} logoutLocal(); };
  $('#bg').onclick = () => toggleSide();
  $('#bell').onclick = openNotifs;
  loadNotifs(); clearInterval(notifTimer); notifTimer = setInterval(loadNotifs, 60000);
  if (notifChannel) sb.removeChannel(notifChannel);
  notifChannel = sb.channel('notifs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => loadNotifs()).subscribe();
  route();
  pushPrompt();
  try { navigator.storage?.persist?.(); } catch {}
}
function toggleSide(force) {
  const s = $('#side'), open = force ?? !s.classList.contains('open');
  s.classList.toggle('open', open); $('.scrim')?.remove();
  if (open) { const d = document.createElement('div'); d.className = 'scrim'; d.onclick = () => toggleSide(false); document.body.append(d); }
}
window.addEventListener('hashchange', () => { if (window._pub || /^#\/(view|approve|portal|pay)\//.test(location.hash)) return location.reload(); if (meta) route(); });

async function route() {
  toggleSide(false);
  const k = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === k));
  const view = $('#view');
  try {
    if (k === 'dashboard') { $('#title').textContent = 'Dashboard'; await dashboard(view); }
    else if (k === 'settings') { $('#title').textContent = 'Settings'; settings(view); }
    else if (k === 'tower') { $('#title').textContent = 'Control tower'; await controlTowerView(view); }
    else if (k === 'followups' && meta.user.role !== 'staff') { $('#title').textContent = 'Follow-up queue'; await followupsView(view); }
    else if (k === 'crm' && meta.user.role !== 'staff') { $('#title').textContent = 'Marketing analytics'; await crmView(view); }
    else if (k === 'workload') { $('#title').textContent = 'Team workload'; await workloadView(view); }
    else if (k === 'receivables' && meta.user.role !== 'staff') { $('#title').textContent = 'Receivables'; await receivablesView(view); }
    else if (k === 'profitability' && meta.user.role !== 'staff') { $('#title').textContent = 'Client profitability'; await profitabilityView(view); }
    else if (k === 'assistant') { $('#title').textContent = 'Ask Claude'; await assistantView(view); }
    else if (meta.entities[k]) { $('#title').textContent = meta.entities[k].label; await entityView(view, k); }
    else location.hash = '#/dashboard';
  } catch (err) { view.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

// ---------- notifications ----------
async function loadNotifs() {
  try {
    const n = await api('/notifications'); window._notifs = n.items;
    const b = $('#bb'); if (b) { b.textContent = n.unread; b.hidden = !n.unread; }
  } catch {}
}
function openNotifs() {
  const items = window._notifs || [];
  const d = document.createElement('div'); d.className = 'drawer';
  d.innerHTML = `<header><b>Notifications</b><span><button class="btn ghost sm" id="mr">Mark all read</button> <button class="btn ghost sm" id="cl">✕</button></span></header>
   <div class="list">${items.map((n) => `<div class="n ${n.read ? '' : 'u'}" data-u="${esc(n.url)}"><b>${esc(n.title)}</b><div>${esc(n.body)}</div><small>${esc(new Date(n.created_at).toLocaleString())}</small></div>`).join('') || '<div class="empty">Nothing yet</div>'}</div>`;
  document.body.append(d);
  $('#cl', d).onclick = () => d.remove();
  $('#mr', d).onclick = async () => { await api('/notifications/read', { method: 'POST' }); loadNotifs(); d.remove(); };
  d.querySelectorAll('.n').forEach((el) => (el.onclick = () => { location.hash = el.dataset.u; d.remove(); }));
}

// ---------- dashboard ----------
async function dashboard(view) {
  const [d, att] = await Promise.all([api('/dashboard'), api('/attendance/today')]);
  const mgr = meta.user.role !== 'staff';
  const kpi = (t, v, s = '') => `<div class="panel kpi"><small>${t}</small><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const max = Math.max(1, ...(d.trend || []).flatMap((x) => [x.revenue, x.expenses]));
  const attBtn = !att ? 'Check in' : !att.check_out ? 'Check out' : null;
  view.innerHTML = `
   <div class="panel" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
     <div><b>Hello, ${esc(meta.user.name.split(' ')[0])} 👋</b><div class="s" style="color:var(--mute)">${att ? `Checked in ${esc(att.check_in)}${att.check_out ? ' · out ' + esc(att.check_out) : ''}` : 'You have not checked in today'}</div></div>
     ${attBtn ? `<button class="btn" id="att">${attBtn}</button>` : '<span class="tag ok">Day complete</span>'}</div>
   <div class="grid">
     ${mgr ? kpi('Revenue (this month)', money(d.revenueMonth), 'Paid invoices') + kpi('Outstanding', money(d.outstanding.v), `${d.outstanding.n} invoices · ${d.overdue.n} overdue`) + kpi('Expenses (this month)', money(d.expenseMonth), `${d.pendingExpenses} awaiting approval`) : ''}
     ${kpi('Active projects', d.activeProjects)}${kpi('Open leads', d.openLeads.n, money(d.openLeads.v) + ' pipeline')}${kpi('Open tickets', d.openTickets)}
     ${mgr ? kpi('Pending leaves', d.pendingLeaves) : ''}</div>
   <div class="two">
     ${mgr ? `<div class="panel"><h3>Revenue vs expenses (6 months)</h3><div class="bars">${d.trend.map((x) => `<div class="c"><div class="pair">
        <div class="b" title="Revenue ${money(x.revenue)}" style="height:${(x.revenue / max) * 100}%;background:var(--brand)"></div>
        <div class="b" title="Expenses ${money(x.expenses)}" style="height:${(x.expenses / max) * 100}%;background:#6b7280"></div></div><small>${x.m.slice(5)}</small></div>`).join('')}</div>
        <div class="legend"><span><i class="dot" style="background:var(--brand)"></i>Revenue</span><span><i class="dot" style="background:#6b7280"></i>Expenses</span></div></div>` : ''}
     <div class="panel"><h3>My open tasks</h3>${d.myTasks.map((t) => `<div class="row"><span><a href="#/tasks">${esc(t.title)}</a><br><small style="color:var(--mute)">${esc(t.status)}${t.due_date ? ' · due ' + esc(t.due_date) : ''}</small></span>${tag(t.priority)}</div>`).join('') || '<div class="empty">No open tasks 🎉</div>'}
       <h3 style="margin-top:14px">Out today</h3><div>${d.onLeave.map(esc).join(', ') || '<span style="color:var(--mute)">Everyone is in</span>'}</div></div></div>`;
  const ab = $('#att'); if (ab) ab.onclick = async () => { await api('/attendance/toggle', { method: 'POST' }); route(); };
  await productionPanels(view);
}

// ---------- generic module ----------
const TAGS = {
  ok: ['Active', 'Paid', 'Won', 'Done', 'Approved', 'Completed', 'Resolved', 'Closed', 'Reimbursed', 'In use', 'Yes', 'Published', 'Confirmed', 'Accepted', 'Available'],
  bad: ['Overdue', 'Rejected', 'Lost', 'Urgent', 'Cancelled', 'Left', 'No', 'Changes needed', 'Changes requested', 'Blacklisted', 'Expired'],
  warn: ['Pending', 'High', 'On hold', 'Review', 'Waiting', 'Repair', 'On notice', 'Sent', 'Internal review', 'Client review', 'Sent to client', 'Pending approval', 'Postponed', 'Busy'],
  info: ['Replied', 'Meeting', 'In progress', 'Proposal', 'Contacted', 'Open', 'Planning', 'Medium', 'Scripting', 'Ready to shoot', 'Shoot scheduled', 'Shot', 'Editing', 'Scheduled', 'Planned', 'In production'],
};
const tagClass = (v) => Object.keys(TAGS).find((k) => TAGS[k].includes(v)) || '';
function tag(v) { if (v == null || v === '') return ''; return `<span class="tag ${tagClass(v)}">${esc(v)}</span>`; }
async function lookup(to) { if (!lookups[to]) lookups[to] = await api('/lookup/' + to); return lookups[to]; }
const lbl = (to, id) => (id == null || id === '' ? '' : lookups[to]?.find((x) => String(x.id) === String(id))?.label ?? '');

function cell(f, row) {
  const v = row[f.k];
  if (f.t === 'score') return scoreBadge(row);
  if (f.t === 'ref') return esc(lbl(f.to, v) || (f.k === 'created_by' ? '' : ''));
  if (f.t === 'money') return v == null ? '' : money(v);
  if (f.t === 'multi') return esc((Array.isArray(v) ? v : []).map((x) => lbl(f.to, x)).filter(Boolean).join(', '));
  if (f.t === 'select') return tag(v);
  return esc(v);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const longDate = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '');
let calMonth = new Date(); calMonth.setDate(1);

async function entityView(view, key) {
  const e = meta.entities[key];
  const refs = [...new Set(e.fields.filter((f) => f.t === 'ref' || f.t === 'multi').map((f) => f.to))];
  await Promise.all([...refs.map(lookup), lookup('users')]);
  const colF = e.cols.map((k) => e.fields.find((f) => f.k === k) || (k === 'score' ? { k, l: 'Score', t: 'score' } : { k, l: k === 'created_by' ? 'Submitted by' : k, t: k === 'created_by' ? 'ref' : 'text', to: 'users' }));
  const modes = ['table', ...(e.board ? ['board'] : []), ...(e.calendar ? ['calendar'] : [])];
  const savedMode = localStorage.getItem('mode:' + key);
  let mode = modes.includes(savedMode) ? savedMode : modes.includes(e.defaultMode) ? e.defaultMode : 'table', q = '', cache = [];
  const flt = {};
  const MODE_L = { table: '☰ Table', board: '▦ Board', calendar: '🗓 Calendar' };
  const fdefs = (e.filters || []).map((k) => e.fields.find((f) => f.k === k)).filter(Boolean);
  view.innerHTML = `<div class="bar"><input id="q" placeholder="Search…" type="search">
    ${modes.length > 1 ? `<div class="seg" id="seg">${modes.map((m) => `<button data-m="${m}" class="${m === mode ? 'on' : ''}">${MODE_L[m]}</button>`).join('')}</div>` : ''}<span class="sp"></span>
    ${key === 'shoots' && e.can.create ? '<button class="btn ghost" id="aishoot">✨ Plan shoots</button>' : ''}
    ${e.import && e.can.create ? '<button class="btn ghost" id="tpl">⬇ Template</button><button class="btn ghost" id="imp">⬆ Import CSV</button>' : ''}
    <button class="btn ghost" id="exp">⬇ CSV</button>${e.can.create ? '<button class="btn" id="new">+ New</button>' : ''}</div>
    ${fdefs.length ? `<div class="flt">${fdefs.map((f) => `<select data-f="${f.k}"><option value="">${esc(f.l.replace(/\s*\(.*$/, ''))}: all</option>${(f.t === 'ref' ? (lookups[f.to] || []).map((o) => [o.id, o.label]) : (f.opts || []).map((o) => [o, o])).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`).join('')}</div>` : ''}
    <div id="data"></div>`;
  const filtered = () => cache.filter((r) => Object.entries(flt).every(([k, v]) => !v || String(r[k]) === v));
  const preset = () => ({ ...(flt.client_id ? { client_id: flt.client_id } : {}), ...(flt.project_id ? { project_id: flt.project_id } : {}) });

  async function load() { cache = await api(`/e/${key}?q=${encodeURIComponent(q)}`); draw(); }
  function draw() {
    const rows = filtered(), box = $('#data');
    if (mode === 'calendar') return drawCal(box, rows);
    if (!rows.length) { box.innerHTML = `<div class="empty">No records yet.</div>`; return; }
    if (mode === 'board') {
      const bf = e.fields.find((f) => f.k === e.board), titleF = e.labelField;
      box.innerHTML = `<div class="board">${bf.opts.map((o) => `<div class="col" data-v="${esc(o)}"><h4>${esc(o)}<span>${rows.filter((r) => r[e.board] === o).length}</span></h4>
        ${rows.filter((r) => r[e.board] === o).map((r) => `<div class="card2" draggable="${e.can.update}" data-id="${r.id}"><b>${esc(r[titleF])}</b><br><small>${esc([lbl('clients', r.client_id), ...e.cols.filter((c) => c !== titleF && c !== e.board && c !== 'client_id').slice(0, 2).map((c) => cell(colF.find((f) => f.k === c), r).replace(/<[^>]+>/g, ''))].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>`).join('')}</div>`;
      box.querySelectorAll('.card2').forEach((c) => {
        c.onclick = () => form(key, rows.find((r) => r.id == c.dataset.id), load);
        c.ondragstart = (ev) => ev.dataTransfer.setData('text', c.dataset.id);
      });
      box.querySelectorAll('.col').forEach((col) => {
        col.ondragover = (ev) => { ev.preventDefault(); col.classList.add('over'); };
        col.ondragleave = () => col.classList.remove('over');
        col.ondrop = async (ev) => {
          ev.preventDefault(); col.classList.remove('over');
          const row = rows.find((r) => r.id == ev.dataTransfer.getData('text'));
          if (!row || row[e.board] === col.dataset.v) return;
          try { let extra = {}; if (key === 'leads' && col.dataset.v === 'Lost') { const r = await askLostReason(); if (!r) return; extra.lost_reason = r; } await api(`/e/${key}/${row.id}`, { method: 'PUT', body: { ...row, ...extra, [e.board]: col.dataset.v } }); load(); } catch (err) { toast(err.message); }
        };
      });
    } else {
      drawTable(box, rows);
    }
  }
  let sortK = null, sortD = 1;
  const sortVal = (f, r) => { const v = r[f.k]; if (f.t === 'score') return leadScore(r) ?? -1; if (f.t === 'ref') return String(lbl(f.to, v) || '').toLowerCase(); if (f.t === 'money' || f.t === 'number') return +v || 0; return String(v ?? '').toLowerCase(); };
  function drawTable(box, rows) {
    const f0 = colF.find((f) => f.k === sortK); if (f0) rows = [...rows].sort((a, b) => { const x = sortVal(f0, a), y = sortVal(f0, b); return (x < y ? -1 : x > y ? 1 : 0) * sortD; });
    const bulk = e.bulk && e.can.update, selected = new Set(box._sel || []);
    box.innerHTML = `<div id="bulkbar"></div><div class="tw"><table><thead><tr>${bulk ? '<th style="width:34px"><input type="checkbox" id="selall"></th>' : ''}${colF.map((f) => `<th data-sort="${f.k}" class="srt">${esc(String(f.l).replace(/\s*\(.*$/, ''))}${f.k === sortK ? (sortD > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => `<tr data-id="${r.id}">${bulk ? `<td><input type="checkbox" class="sel" data-id="${r.id}" ${selected.has(String(r.id)) ? 'checked' : ''}></td>` : ''}${colF.map((f) => `<td>${cell(f, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    box.querySelectorAll('th[data-sort]').forEach((th) => (th.onclick = () => { if (sortK === th.dataset.sort) sortD = -sortD; else { sortK = th.dataset.sort; sortD = 1; } box._sel = [...box.querySelectorAll('.sel:checked')].map((c) => c.dataset.id); drawTable(box, filtered()); }));
    box.querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = (ev) => { if (ev.target.closest('input')) return; form(key, rows.find((r) => r.id == tr.dataset.id), load); }));
    if (bulk) {
      const getSel = () => [...box.querySelectorAll('.sel:checked')].map((c) => rows.find((r) => String(r.id) === c.dataset.id)).filter(Boolean), bar = box.querySelector('#bulkbar');
      const refresh = () => { bulkBar(rows, getSel, load, bar); const all = box.querySelectorAll('.sel'); const sa = box.querySelector('#selall'); if (sa) sa.checked = all.length > 0 && [...all].every((c) => c.checked); };
      box.querySelectorAll('.sel').forEach((c) => (c.onchange = refresh));
      box.querySelector('#selall').onchange = (ev) => { box.querySelectorAll('.sel').forEach((c) => (c.checked = ev.target.checked)); refresh(); };
      refresh();
    }
  }
  function drawCal(box, rows) {
    const df = e.calendar.date, y = calMonth.getFullYear(), m = calMonth.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7, weeks = Math.ceil((offset + new Date(y, m + 1, 0).getDate()) / 7), start = new Date(y, m, 1 - offset);
    const by = {}, undated = [];
    rows.forEach((r) => { const d = r[df]; if (!d) undated.push(r); else (by[String(d).slice(0, 10)] ||= []).push(r); });
    const title = (r) => key === 'leaves' ? `${lbl('users', r.user_id)} · ${r.type}` : `${r.call_time || r.meeting_time || r.publish_time ? (r.call_time || r.meeting_time || r.publish_time) + ' ' : ''}${r[e.labelField] ?? ''}`;
    const sub = (r) => [lbl('clients', r.client_id), r.format || r.kind || r.status].filter(Boolean).join(' · ');
    const ev = (r) => `<div class="ev ${tagClass(r.status || r.stage)}" draggable="${e.can.update}" data-id="${r.id}" title="${esc(r[e.labelField])}">${esc(title(r))}<small>${esc(sub(r))}</small></div>`;
    const t0 = today(), cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d);
      cells.push(`<div class="d ${d.getMonth() !== m ? 'out' : ''} ${k === t0 ? 'today' : ''}" data-d="${k}"><div class="n"><span>${d.getDate()}</span>${e.can.create ? `<i data-add="${k}" title="Add here">＋</i>` : ''}</div>${(by[k] || []).map(ev).join('')}</div>`);
    }
    box.innerHTML = `<div class="calwrap"><div class="calhd"><button class="btn ghost sm" data-nav="-1">‹</button><h3>${calMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3><button class="btn ghost sm" data-nav="0">Today</button><button class="btn ghost sm" data-nav="1">›</button></div>
      <div class="cal">${DAYS.map((d) => `<div class="dh">${d}</div>`).join('')}${cells.join('')}</div></div>
      ${undated.length ? `<div class="panel undated"><h3>No date yet (${undated.length})</h3>${undated.map(ev).join('')}</div>` : ''}`;
    box.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { const n = +b.dataset.nav; calMonth = n ? new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1) : (() => { const d = new Date(); d.setDate(1); return d; })(); draw(); }));
    box.querySelectorAll('.ev').forEach((c) => {
      c.onclick = () => form(key, rows.find((r) => r.id == c.dataset.id), load);
      c.ondragstart = (xe) => xe.dataTransfer.setData('text', c.dataset.id);
    });
    box.querySelectorAll('[data-add]').forEach((b) => (b.onclick = (xe) => { xe.stopPropagation(); form(key, null, load, { [df]: b.dataset.add, ...preset() }); }));
    box.querySelectorAll('.d').forEach((cl) => {
      cl.ondragover = (xe) => { xe.preventDefault(); cl.classList.add('over'); };
      cl.ondragleave = () => cl.classList.remove('over');
      cl.ondrop = async (xe) => {
        xe.preventDefault(); cl.classList.remove('over');
        const row = rows.find((r) => r.id == xe.dataTransfer.getData('text'));
        if (!row || !e.can.update || String(row[df]).slice(0, 10) === cl.dataset.d) return;
        try { await api(`/e/${key}/${row.id}`, { method: 'PUT', body: { ...row, [df]: cl.dataset.d } }); toast('Moved to ' + cl.dataset.d); load(); } catch (err) { toast(err.message); }
      };
    });
  }
  $('#seg')?.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    mode = b.dataset.m; localStorage.setItem('mode:' + key, mode);
    $('#seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw();
  }));
  view.querySelectorAll('.flt select').forEach((s) => (s.onchange = () => { flt[s.dataset.f] = s.value; draw(); }));
  let tm; $('#q').oninput = (ev) => { clearTimeout(tm); tm = setTimeout(() => { q = ev.target.value; load(); }, 250); };
  $('#exp').onclick = async () => {
    const csv = await api(`/e/${key}/export`), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${key}-${today()}.csv`; a.click();
  };
  if ($('#new')) $('#new').onclick = () => form(key, null, load, preset());
  if ($('#tpl')) $('#tpl').onclick = () => downloadTemplate(key);
  if ($('#imp')) $('#imp').onclick = () => importFlow(key, load);
  if ($('#aishoot')) $('#aishoot').onclick = (ev) => aiRun(ev.currentTarget, () => aiShootPlan(load));
  await load();
}

function form(key, row, after, preset = {}) {
  const e = meta.entities[key], isNew = !row, editable = isNew ? e.can.create : e.can.update;
  const ov = document.createElement('div'); ov.className = 'ov';
  const input = (f) => {
    if (f.sec) return `<div class="sec">${esc(f.sec)}</div>`;
    const v = row?.[f.k] ?? (isNew ? (preset[f.k] ?? (f.def === 'today' ? today() : f.def ?? '')) : ''), dis = !editable || f.ro ? 'disabled' : '';
    if (f.t === 'items') return `<div class="items"><label>${esc(f.l)}</label><div id="li"></div>${dis ? '' : '<button type="button" class="btn ghost sm" id="addli">+ Add line</button>'}<div id="tot" style="text-align:right;margin-top:8px"></div></div>`;
    if (f.t === 'deductions') return `<div class="items"><label>${esc(f.l)}</label><div id="dd"></div>${dis ? '' : '<button type="button" class="btn ghost sm" id="adddd">+ Add deduction</button>'}</div>`;
    const wrap = (inner, full) => `<div class="${full ? 'full' : ''}"><label>${esc(f.l)}${f.req ? ' *' : ''}</label>${inner}</div>`;
    if (f.t === 'textarea') return wrap(`<textarea name="${f.k}" ${dis}>${esc(v)}</textarea>`, 1);
    if (f.t === 'select') return wrap(`<select name="${f.k}" ${dis}><option value=""></option>${f.opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
    if (f.t === 'ref') return wrap(`<select name="${f.k}" ${dis}><option value=""></option>${(lookups[f.to] || []).map((o) => `<option value="${o.id}" ${o.id == v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
    if (f.t === 'money' || f.t === 'number') return wrap(`<input name="${f.k}" type="number" step="any" value="${esc(v)}" ${dis}>`);
    if (f.t === 'multi') { let sel = row?.[f.k] ?? []; if (typeof sel === 'string') { try { sel = JSON.parse(sel); } catch { sel = []; } } sel = sel.map(String);
      return wrap(`<div class="multi" data-multi="${f.k}">${(lookups[f.to] || []).map((o) => `<label><input type="checkbox" value="${esc(o.id)}" ${sel.includes(String(o.id)) ? 'checked' : ''} ${dis}>${esc(o.label)}</label>`).join('') || '<small>Nothing to pick yet</small>'}</div>`, 1); }
    if (f.t === 'checklist') return `<div class="cad"><label>${esc(f.l)}</label><div id="ckr"></div>${dis ? '' : '<button type="button" class="btn ghost sm" id="addck">+ Add task</button>'}</div>`;
    if (f.t === 'cadence') return `<div class="cad"><label>${esc(f.l)}</label><div id="cadr"></div>${dis ? '' : '<button type="button" class="btn ghost sm" id="addcad">+ Add slot</button>'}</div>`;
    if (f.t === 'itempick') return `<div class="full"><label>${esc(f.l)}</label><div class="pick" id="pick"><small>Choose a client first</small></div></div>`;
    if (f.t === 'month') return wrap(`<input name="${f.k}" type="month" value="${esc(v)}" ${dis}>`);
    if (f.t === 'time') return wrap(`<input name="${f.k}" type="time" value="${esc(v)}" ${dis}>`);
    if (f.t === 'date') return wrap(`<input name="${f.k}" type="date" value="${esc(v)}" ${dis}>`);
    if (f.t === 'password') return wrap(`<input name="${f.k}" type="password" autocomplete="new-password" ${dis}>`);
    return wrap(`<input name="${f.k}" type="${f.t === 'email' ? 'email' : f.t === 'tel' ? 'tel' : 'text'}" value="${esc(v)}" ${dis}>`);
  };
  const fields = e.fields.filter((f) => !(isNew && f.auto));
  ov.innerHTML = `<form class="modal"><header><h3>${isNew ? 'New' : 'Edit'} · ${esc(e.label)}</h3><button type="button" class="btn ghost sm" id="x">✕</button></header>
    <div class="body">${fields.map(input).join('')}</div>
    <footer><span id="fe" class="err" style="flex:1;margin:0;align-self:center"></span>
    ${editable && (key === 'content_items' || key === 'shoots') ? '<div class="acts" id="aiacts"></div>' : ''}
    ${!isNew && e.can.update ? `<div class="acts">${(e.actions || []).filter((a) => ACTIONS[a]).map((a) => `<button type="button" class="btn ghost" data-act="${a}">${ACTIONS[a].label}</button>`).join('')}</div>` : ''}
    ${key === 'invoices' && !isNew ? '<button type="button" class="btn ghost" id="pr">🖨 Print / PDF</button>' : ''}
    ${!isNew && e.can.del ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}
    ${editable ? '<button class="btn">Save</button>' : ''}</footer></form>`;
  document.body.append(ov);
  const close = () => ov.remove();
  $('#x', ov).onclick = close;
  ov.onmousedown = (ev) => { if (ev.target === ov) close(); };

  let lines = [], deds = [];
  const itemsF = fields.find((f) => f.t === 'items');
  if (itemsF) {
    try { lines = JSON.parse(row?.items || '[]'); } catch {}
    lines = lines.map((l) => ({ desc: l.desc || '', note: l.note || '', amount: l.amount ?? ((+l.qty || 0) * (+l.rate || 0) || '') }));
    if (!lines.length) lines = [{ desc: '', note: '', amount: '' }];
    try { deds = JSON.parse(row?.deductions || '[]'); } catch {}
    if (Array.isArray(row?.deductions)) deds = row.deductions;
    const num = (n) => +ov.querySelector(`[name=${n}]`)?.value || 0;
    const recalc = () => {
      const sub = lines.reduce((s, l) => s + (+l.amount || 0), 0), tax = sub * num('tax_percent') / 100,
        less = deds.reduce((s, d) => s + (+d.amount || 0), 0), cf = num('carry_forward');
      $('#tot', ov).innerHTML = `Subtotal ${money2(sub)}${tax ? ` · Tax ${money2(tax)}` : ''}${less ? ` · Less ${money2(less)}` : ''}${cf ? ` · Carried fwd ${money2(cf)}` : ''} · <b>Payable now ${money2(sub + tax - less - cf)}</b>`;
    };
    const draw = () => {
      $('#li', ov).innerHTML = lines.map((l, i) => `<div class="li"><div><input data-i="${i}" data-f="desc" placeholder="Service (e.g. Social Media Branding)" value="${esc(l.desc)}"><input data-i="${i}" data-f="note" placeholder="Details (optional, shown in italics)" value="${esc(l.note)}" style="margin-top:6px"></div><input data-i="${i}" data-f="amount" type="number" step="any" placeholder="Amount" value="${esc(l.amount)}"><button type="button" class="btn ghost sm" data-rm="${i}">✕</button></div>`).join('');
      ov.querySelectorAll('#li input').forEach((inp) => (inp.oninput = () => { lines[inp.dataset.i][inp.dataset.f] = inp.value; recalc(); }));
      ov.querySelectorAll('#li [data-rm]').forEach((b) => (b.onclick = () => { lines.splice(b.dataset.rm, 1); draw(); }));
      recalc();
    };
    const drawD = () => {
      const box = $('#dd', ov); if (!box) return;
      box.innerHTML = deds.map((d, i) => `<div class="li"><input data-i="${i}" data-f="label" placeholder="e.g. Advance received" value="${esc(d.label)}"><input data-i="${i}" data-f="amount" type="number" step="any" placeholder="Amount" value="${esc(d.amount)}"><button type="button" class="btn ghost sm" data-rmd="${i}">✕</button></div>`).join('');
      box.querySelectorAll('input').forEach((inp) => (inp.oninput = () => { deds[inp.dataset.i][inp.dataset.f] = inp.value; recalc(); }));
      box.querySelectorAll('[data-rmd]').forEach((b) => (b.onclick = () => { deds.splice(b.dataset.rmd, 1); drawD(); recalc(); }));
    };
    draw(); drawD();
    if ($('#addli', ov)) $('#addli', ov).onclick = () => { lines.push({ desc: '', note: '', amount: '' }); draw(); };
    if ($('#adddd', ov)) $('#adddd', ov).onclick = () => { deds.push({ label: 'Advance received', amount: '' }); drawD(); };
    ['tax_percent', 'carry_forward'].forEach((n) => ov.querySelector(`[name=${n}]`)?.addEventListener('input', recalc));
  }
  const ckF = fields.find((f) => f.t === 'checklist');
  const getChecklist = ckF ? checklistEditor(ov, ckF, row) : null;
  if (!isNew && (COMMENTABLE.has(key) || ATTACHABLE.has(key))) { $('.body', ov).insertAdjacentHTML('beforeend', '<div class="full extras" id="extras"></div>'); renderExtras(ov, key, row); }
  // posting-cadence editor (content plans)
  let cad = [];
  if (fields.some((f) => f.t === 'cadence')) {
    let cs = row?.cadence ?? []; if (typeof cs === 'string') { try { cs = JSON.parse(cs); } catch { cs = []; } }
    cad = cs.map((c) => ({ ...c, days: [...(c.days || [])] }));
    const cf = meta.entities.content_items?.fields || [], opts = (k) => cf.find((f) => f.k === k)?.opts || [];
    const sel = (i, k, cur) => `<select data-i="${i}" data-f="${k}"><option value=""></option>${opts(k).map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const drawC = () => {
      const box = $('#cadr', ov);
      box.innerHTML = cad.map((c, i) => `<div class="cr">${sel(i, 'format', c.format)}${sel(i, 'platform', c.platform)}<input data-i="${i}" data-f="pillar" placeholder="Pillar / theme" value="${esc(c.pillar || '')}"><button type="button" class="btn ghost sm" data-rmc="${i}">✕</button>
        <div class="days">${DAYS.map((d) => `<button type="button" data-i="${i}" data-day="${d}" class="${c.days.includes(d) ? 'on' : ''}">${d}</button>`).join('')}</div></div>`).join('') || '<small style="color:var(--mute)">No slots yet. Add e.g. “Reel · Instagram · Mon, Thu”.</small>';
      box.querySelectorAll('select,input').forEach((x) => (x.onchange = x.oninput = () => { cad[x.dataset.i][x.dataset.f] = x.value; }));
      box.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { const c = cad[b.dataset.i], d = b.dataset.day; c.days = c.days.includes(d) ? c.days.filter((x) => x !== d) : [...c.days, d]; drawC(); }));
      box.querySelectorAll('[data-rmc]').forEach((b) => (b.onclick = () => { cad.splice(b.dataset.rmc, 1); drawC(); }));
    };
    drawC();
    if ($('#addcad', ov)) $('#addcad', ov).onclick = () => { cad.push({ format: 'Reel', platform: 'Instagram', pillar: '', days: ['Mon'] }); drawC(); };
  }
  // content pieces attached to a shoot
  let picked = new Set(), allItems = [], pickReady = false;
  if (fields.some((f) => f.t === 'itempick')) {
    const drawP = () => {
      const cv = ov.querySelector('[name=client_id]')?.value, box = $('#pick', ov);
      if (!pickReady) return;
      if (!cv) { box.innerHTML = '<small>Choose a client first</small>'; return; }
      const list = allItems.filter((i) => String(i.client_id) === cv && (['Idea', 'Scripting', 'Ready to shoot'].includes(i.status) || String(i.shoot_id) === String(row?.id)));
      box.innerHTML = list.map((i) => `<label><input type="checkbox" value="${i.id}" ${picked.has(String(i.id)) ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>${esc(i.title)}<br><small>${esc([i.format, i.publish_date && 'goes live ' + i.publish_date, i.status].filter(Boolean).join(' · '))}</small></span></label>`).join('') || '<small>No unshot content for this client. Plan content in the Content calendar first.</small>';
      box.querySelectorAll('input').forEach((x) => (x.onchange = () => (x.checked ? picked.add(x.value) : picked.delete(x.value))));
    };
    api('/e/content_items').then((r) => { allItems = r; if (row) allItems.filter((i) => String(i.shoot_id) === String(row.id)).forEach((i) => picked.add(String(i.id))); pickReady = true; drawP(); }).catch(() => { $('#pick', ov).innerHTML = '<small>Could not load content</small>'; });
    ov.querySelector('[name=client_id]')?.addEventListener('change', () => { picked = new Set(); drawP(); });
  }
  aiFormTools(key, ov, { allItems: () => allItems, picked: () => picked });
  ov.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => { try { await ACTIONS[b.dataset.act].run(row, { close, after, key }); } catch (err) { $('#fe', ov).textContent = err.message; } }));

  ov.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {};
    new FormData(ev.target).forEach((v, k) => (body[k] = v));
    if (itemsF) { body.items = lines.filter((l) => l.desc || +l.amount).map((l) => ({ desc: l.desc, note: l.note, amount: +l.amount || 0 })); body.deductions = deds.filter((d) => +d.amount).map((d) => ({ label: d.label || 'Received', amount: +d.amount })); }
    ov.querySelectorAll('[data-multi]').forEach((bx) => (body[bx.dataset.multi] = [...bx.querySelectorAll('input:checked')].map((i) => (/^\d+$/.test(i.value) ? Number(i.value) : i.value))));
    if (fields.some((f) => f.t === 'cadence')) body.cadence = cad.filter((c) => c.days.length);
    if (getChecklist) body[ckF.k] = getChecklist();
    if (key === 'leads' && body.stage === 'Lost' && !body.lost_reason) { $('#fe', ov).textContent = 'Please choose why this lead was lost'; return; }
    try {
      if (key === 'shoots') { const clash = await shootConflicts(body, row?.id); if (clash.length && !confirm('Possible clash on that day:\n\n' + clash.join('\n') + '\n\nSave anyway?')) return; }
      const saved = await api(isNew ? `/e/${key}` : `/e/${key}/${row.id}`, { method: isNew ? 'POST' : 'PUT', body });
      if (key === 'shoots') await syncShootItems(saved?.id ?? row?.id, picked, allItems, body.status);
      delete lookups[key]; close(); toast('Saved'); after();
    } catch (err) { $('#fe', ov).textContent = err.message; }
  };
  if ($('#del', ov)) $('#del', ov).onclick = async () => {
    if (!confirm('Delete this record permanently?')) return;
    try { await api(`/e/${key}/${row.id}`, { method: 'DELETE' }); close(); toast('Deleted'); after(); } catch (err) { $('#fe', ov).textContent = err.message; }
  };
  if ($('#pr', ov)) $('#pr', ov).onclick = () => printInvoice(row);
}

// ---------- workflow helpers ----------
const arr = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]'); } catch { return []; } };
const VIDEO_FMT = ['Reel', 'YouTube video', 'YouTube Short'];
const PRE_SHOOT = ['Idea', 'Scripting', 'Ready to shoot'];

async function shootConflicts(body, id) {
  if (!body.shoot_date || body.status === 'Cancelled') return [];
  const mine = new Set([...(body.crew_ids || []), body.director_id].filter(Boolean).map(String)), gear = new Set((body.equipment_ids || []).map(String));
  const out = [];
  for (const s of (await api('/e/shoots')).filter((x) => String(x.id) !== String(id) && x.shoot_date === body.shoot_date && x.status !== 'Cancelled')) {
    const ppl = [...arr(s.crew_ids), s.director_id].filter(Boolean).map(String).filter((x) => mine.has(x)).map((x) => lbl('users', x));
    const eq = arr(s.equipment_ids).map(String).filter((x) => gear.has(x)).map((x) => lbl('assets', x));
    if (ppl.length || eq.length) out.push(`• “${s.title}” (${s.call_time || 'all day'}): ${[...ppl, ...eq].join(', ')}`);
  }
  return out;
}
async function syncShootItems(shootId, picked, items, status) {
  if (!shootId || !items.length) return;
  for (const it of items) {
    const on = picked.has(String(it.id)), was = String(it.shoot_id) === String(shootId);
    let next = null;
    if (on && !was) next = { ...it, shoot_id: shootId, status: PRE_SHOOT.includes(it.status) ? 'Shoot scheduled' : it.status };
    else if (!on && was) next = { ...it, shoot_id: null, status: it.status === 'Shoot scheduled' ? 'Ready to shoot' : it.status };
    else if (on && status === 'Completed' && it.status === 'Shoot scheduled') next = { ...it, status: 'Shot' };
    if (next) await api(`/e/content_items/${it.id}`, { method: 'PUT', body: next });
  }
}

function printDoc(title, build, css = '') {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write('<p style="font:14px system-ui;padding:24px">Preparing…</p>');
  (async () => {
    let body = ''; try { body = await build(); } catch (err) { body = `<p>${esc(err.message)}</p>`; }
    const logo = new URL('icons/logo.png', location.href).href;
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:13px/1.45 Georgia,'Times New Roman',serif;color:#1a1a1a;margin:0 auto;padding:24px 28px;max-width:800px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .hd{border-bottom:1.5px solid #e8685d;padding-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end}.hd img{height:54px}.hd span{font-size:11px;letter-spacing:3px;font-weight:bold}
    h1{color:#e03a2f;margin:18px 0 4px;font-size:27px}h2{font-size:12px;letter-spacing:2px;color:#e03a2f;margin:20px 0 6px;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}th{background:#1a1a1a;color:#fff;text-align:left;padding:6px 8px;font-size:11px}td{padding:6px 8px;border:1px solid #ddd;vertical-align:top}
    .kv td:first-child{width:26%;color:#666;background:#faf6f5}.kpi{display:flex;gap:10px;flex-wrap:wrap}.kpi div{flex:1;min-width:105px;border:1px solid #ddd;padding:10px;text-align:center;font-size:11px;color:#666}.kpi b{display:block;font-size:21px;color:#e03a2f}
    pre{white-space:pre-wrap;font:inherit;margin:0}.r{text-align:right}${css}@media print{body{padding:0}}</style></head><body>
    <div class="hd"><img src="${logo}" alt=""><span>DIGITAL SOLUTIONS</span></div>${body}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 700);
  })();
}
const kv = (rows) => `<table class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`;

function callSheet(s) {
  printDoc(`Call sheet — ${s.title}`, async () => {
    const items = (await api('/e/content_items')).filter((i) => String(i.shoot_id) === String(s.id));
    const crew = arr(s.crew_ids).map((x) => lbl('users', x)).filter(Boolean), gear = arr(s.equipment_ids).map((x) => lbl('assets', x)).filter(Boolean);
    return `<h1>CALL SHEET</h1><div style="color:#666">${esc(s.title)}</div>
      <h2>Schedule</h2>${kv([['Date', esc(longDate(s.shoot_date))], ['Call time', esc(s.call_time)], ['Expected wrap', esc(s.wrap_time)], ['Location', esc(s.location)], ['Client', esc(lbl('clients', s.client_id))], ['Lead / director', esc(lbl('users', s.director_id))], ['Status', esc(s.status)]])}
      <h2>Crew</h2>${crew.length ? `<p>${crew.map(esc).join(' · ')}</p>` : '<p>—</p>'}
      <h2>Equipment</h2>${gear.length ? `<p>${gear.map(esc).join(' · ')}</p>` : '<p>—</p>'}
      ${s.talent ? `<h2>Talent</h2><pre>${esc(s.talent)}</pre>` : ''}${s.props ? `<h2>Props, wardrobe &amp; permissions</h2><pre>${esc(s.props)}</pre>` : ''}
      <h2>Content to shoot (${items.length})</h2>${items.length ? `<table><tr><th>#</th><th>Piece</th><th>Format</th><th>Platform</th><th>Goes live</th></tr>${items.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.title)}</b>${i.concept ? `<br><i>${esc(i.concept)}</i>` : ''}</td><td>${esc(i.format)}</td><td>${esc(i.platform)}</td><td>${esc(i.publish_date)}</td></tr>`).join('')}</table>` : '<p>—</p>'}
      ${s.shot_list ? `<h2>Shot list</h2><pre>${esc(s.shot_list)}</pre>` : ''}${s.notes ? `<h2>Notes</h2><pre>${esc(s.notes)}</pre>` : ''}`;
  });
}

function askMonth(title, go) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="max-width:380px"><header><h3>${esc(title)}</h3><button class="btn ghost sm" id="x">✕</button></header><div class="body" style="grid-template-columns:1fr"><div><label>Month</label><input type="month" id="mo" value="${today().slice(0, 7)}"></div></div><footer><button class="btn" id="go">Open report</button></footer></div>`;
  document.body.append(ov); $('#x', ov).onclick = () => ov.remove(); ov.onmousedown = (e) => { if (e.target === ov) ov.remove(); };
  $('#go', ov).onclick = () => { const m = $('#mo', ov).value; if (m) { ov.remove(); go(m); } };
}
function clientReport(c) {
  askMonth(`Monthly report · ${c.name}`, (mo) => printDoc(`Report ${mo} — ${c.name}`, async () => {
    const all = (await api('/e/content_items')).filter((i) => String(i.client_id) === String(c.id) && String(i.posted_on || i.publish_date || '').startsWith(mo));
    const pub = all.filter((i) => i.status === 'Published'), open = all.filter((i) => i.status !== 'Published');
    const sum = (k) => pub.reduce((a, i) => a + (+i[k] || 0), 0), nf = (n) => new Intl.NumberFormat('en-IN').format(n);
    const eng = sum('likes') + sum('comments') + sum('shares') + sum('saves'), pk = (await api('/e/packages').catch(() => [])).find((p) => String(p.client_id) === String(c.id) && p.status === 'Active');
    const vids = pub.filter((i) => VIDEO_FMT.includes(i.format)).length, stat = pub.filter((i) => !VIDEO_FMT.includes(i.format)).length;
    const top = [...pub].sort((a, b) => (+b.views || 0) - (+a.views || 0)).slice(0, 3);
    const label = new Date(mo + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<h1>MONTHLY REPORT</h1><div style="color:#666">${esc(c.name)} · ${esc(label)}</div>
      <h2>Highlights</h2><div class="kpi"><div><b>${pub.length}</b>Posts published</div><div><b>${nf(sum('views'))}</b>Views</div><div><b>${nf(sum('reach'))}</b>Reach</div><div><b>${nf(eng)}</b>Engagements</div><div><b>${sum('reach') ? ((eng / sum('reach')) * 100).toFixed(1) + '%' : '—'}</b>Engagement rate</div></div>
      ${pk ? `<h2>Delivery vs package</h2><table><tr><th>Deliverable</th><th>Committed</th><th>Delivered</th></tr><tr><td>Videos</td><td>${pk.videos_per_month ?? '—'}</td><td>${vids}</td></tr><tr><td>Posts / carousels</td><td>${pk.posts_per_month ?? '—'}</td><td>${stat}</td></tr></table>` : ''}
      ${top.length ? `<h2>Top performing</h2><table><tr><th>Post</th><th class="r">Views</th><th class="r">Likes</th></tr>${top.map((i) => `<tr><td>${esc(i.title)}<br><small>${esc(i.format)} · ${esc(i.platform)}</small></td><td class="r">${nf(i.views || 0)}</td><td class="r">${nf(i.likes || 0)}</td></tr>`).join('')}</table>` : ''}
      <h2>All published content</h2>${pub.length ? `<table><tr><th>Date</th><th>Post</th><th>Platform</th><th class="r">Views</th><th class="r">Likes</th><th class="r">Comments</th><th class="r">Shares</th></tr>${pub.map((i) => `<tr><td>${esc(i.posted_on || i.publish_date)}</td><td>${esc(i.title)}</td><td>${esc(i.platform)}</td><td class="r">${nf(i.views || 0)}</td><td class="r">${nf(i.likes || 0)}</td><td class="r">${nf(i.comments || 0)}</td><td class="r">${nf(i.shares || 0)}</td></tr>`).join('')}</table>` : '<p>Nothing published this month.</p>'}
      ${open.length ? `<h2>In the pipeline (${open.length})</h2><table><tr><th>Piece</th><th>Stage</th><th>Planned</th></tr>${open.map((i) => `<tr><td>${esc(i.title)}</td><td>${esc(i.status)}</td><td>${esc(i.publish_date)}</td></tr>`).join('')}</table>` : ''}`;
  }));
}

const ACTIONS = {
  generate_calendar: {
    label: '✨ Generate content calendar',
    async run(plan, ctx) {
      const cad = arr(plan.cadence).filter((c) => c.days?.length);
      if (!cad.length) return toast('Add at least one posting slot (format + days) to the plan, save, then generate');
      const [y, m] = String(plan.month).split('-').map(Number), last = new Date(y, m, 0).getDate();
      const have = (await api('/e/content_items')).filter((i) => String(i.plan_id) === String(plan.id)), slots = [];
      for (let d = 1; d <= last; d++) {
        const dt = new Date(y, m - 1, d), dn = DAYS[(dt.getDay() + 6) % 7], k = iso(dt);
        for (const c of cad) if (c.days.includes(dn) && !have.some((i) => i.publish_date === k && i.format === c.format && (i.platform || '') === (c.platform || ''))) slots.push({ c, k, dt });
      }
      if (!slots.length) return toast('The calendar already has every slot in this plan');
      if (!confirm(`Create ${slots.length} content slots for ${MON[m - 1]} ${y} in the Content calendar?\nEach starts at stage “Idea” — assign writers/editors afterwards.`)) return;
      for (const { c, k, dt } of slots)
        await api('/e/content_items', { method: 'POST', body: { client_id: plan.client_id, plan_id: plan.id, title: `${c.pillar || c.format} · ${dt.getDate()} ${MON[dt.getMonth()]}`, pillar: c.pillar, format: c.format, platform: c.platform, publish_date: k, status: 'Idea', owner_id: meta.user.id } });
      if (plan.status === 'Approved') await api(`/e/content_plans/${plan.id}`, { method: 'PUT', body: { ...plan, status: 'In production' } });
      ctx.close(); toast(`${slots.length} slots added to the calendar`); location.hash = '#/content_items';
    },
  },
  call_sheet: { label: '🖨 Call sheet', run: (s) => callSheet(s) },
  client_report: { label: '📈 Monthly report', run: (c) => clientReport(c) },
  convert_lead: {
    label: '🎉 Convert to client',
    async run(lead, ctx) {
      if (!confirm(`Convert “${lead.name}” into a client, create a production project and the onboarding checklist?`)) return;
      const owner = lead.owner_id || meta.user.id, nm = lead.company || lead.name;
      const code = nm.split(/\s+/).map((w) => w[0]).join('').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
      const c = await api('/e/clients', { method: 'POST', body: { name: nm, contact_person: lead.name, email: lead.email, phone: lead.phone, status: 'Active', code, onboarded_on: today(), account_manager_id: owner } });
      const p = await api('/e/projects', { method: 'POST', body: { name: `${nm} — content production`, client_id: c.id, status: 'Active', manager_id: owner, start_date: today() } });
      for (const [t, n] of [['Sign agreement & collect advance', 2], ['Collect brand assets, logos & guidelines', 3], ['Get access to social accounts', 3], ['Kickoff meeting with client', 5], ['Create month-1 content plan', 7], ['Schedule first shoot', 10]])
        await api('/e/tasks', { method: 'POST', body: { title: `${nm}: ${t}`, project_id: p.id, assignee_id: owner, priority: 'High', status: 'To do', due_date: addDays(n) } });
      await api(`/e/leads/${lead.id}`, { method: 'PUT', body: { ...lead, stage: 'Won' } });
      delete lookups.clients; delete lookups.projects; ctx.close(); toast('Client created with project and onboarding tasks'); location.hash = '#/clients';
    },
  },
  raise_invoice: {
    label: '🧾 Raise this month’s invoice',
    async run(pk, ctx) {
      const mo = today().slice(0, 7), name = new Date(mo + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      if (!confirm(`Create a draft invoice for ${name} — ${pk.name} (${money(pk.monthly_fee)})?`)) return;
      const vids = (await api('/e/content_items')).filter((i) => String(i.client_id) === String(pk.client_id) && i.status === 'Published' && VIDEO_FMT.includes(i.format) && String(i.posted_on || i.publish_date || '').startsWith(mo)).length;
      await api('/e/invoices', { method: 'POST', body: { client_id: pk.client_id, client_ref: `${lbl('clients', pk.client_id)} – ${pk.name}`, issue_date: today(), due_date: addDays(7), items: [{ desc: `${pk.name} — ${name}`, note: String(pk.inclusions || '').split('\n')[0], amount: pk.monthly_fee || 0 }], tax_percent: pk.tax_percent || 0, videos_committed: pk.videos_per_month, videos_delivered: vids, status: 'Draft' } });
      ctx.close(); toast('Draft invoice created'); location.hash = '#/invoices';
    },
  },
  quote_print: { label: '🖨 Print / PDF', run: (q) => printInvoice(q, 'quote') },
  whatsapp_invoice: { label: '💬 Send on WhatsApp', run: (d) => openWhatsApp(d, 'inv') },
  whatsapp_quote: { label: '💬 Send on WhatsApp', run: (d) => openWhatsApp(d, 'quote') },
  email_invoice: { label: '📧 Send by email', run: (d) => openEmail(d, 'inv') },
  email_quote: { label: '📧 Send by email', run: (d) => openEmail(d, 'quote') },
  quote_to_invoice: {
    label: '➡ Convert to invoice',
    async run(q, ctx) {
      if (!q.client_id) throw new Error('Pick a client on the quote first (convert the lead to a client from Leads)');
      if (!confirm(`Create a draft invoice from ${q.number}?`)) return;
      await api('/e/invoices', { method: 'POST', body: { client_id: q.client_id, client_ref: q.title, issue_date: today(), due_date: addDays(7), items: arr(q.items), tax_percent: q.tax_percent || 0, notes: q.notes, status: 'Draft' } });
      if (q.status !== 'Accepted') await api(`/e/quotes/${q.id}`, { method: 'PUT', body: { ...q, status: 'Accepted' } });
      ctx.close(); toast('Draft invoice created'); location.hash = '#/invoices';
    },
  },
};

// ---------- WhatsApp sharing + public (no-login) document view ----------
const waNumber = (p) => { let d = String(p || '').replace(/\D/g, '').replace(/^0+/, ''); if (d.length === 10) d = '91' + d; return d; };
function shareLink(kind, token) { return `${location.origin}${location.pathname}#/view/${kind}/${token}`; }
async function openWhatsApp(doc, kind) {
  const isQ = kind === 'quote';
  if (!doc.share_token) throw new Error('Sharing is not set up yet — run migration 006 in Supabase');
  let who = {};
  try { who = (await api('/e/clients')).find((c) => String(c.id) === String(doc.client_id)) || {}; } catch {}
  if (!who.name && doc.lead_id) { try { const l = (await api('/e/leads')).find((x) => String(x.id) === String(doc.lead_id)); who = { name: l?.company || l?.name, contact_person: l?.name, phone: l?.phone }; } catch {} }
  const link = shareLink(kind, doc.share_token), nice = isQ ? 'quotation' : 'invoice';
  const due = !isQ && doc.due_date ? ` Due by ${new Date(doc.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}.` : '';
  const msg = `Hello ${who.contact_person || who.name || ''},\n\nPlease find ${nice} ${doc.number} from Redeye Digital Solutions for ${money2(doc.total)}.${due}\n\nView / download PDF: ${link}\n\nThank you!`;
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="max-width:520px"><header><h3>💬 Send ${nice} on WhatsApp</h3><button class="btn ghost sm" id="x">✕</button></header>
    <div class="body" style="grid-template-columns:1fr"><div><label>WhatsApp number (with country code)</label><input id="ph" type="tel" value="${esc(waNumber(who.phone))}" placeholder="91XXXXXXXXXX"></div>
    <div><label>Message</label><textarea id="msg" style="min-height:170px">${esc(msg)}</textarea></div>
    ${doc.status === 'Draft' ? '<label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink)"><input type="checkbox" id="ms" checked style="width:auto"> Mark as Sent after opening WhatsApp</label>' : ''}
    <small style="color:var(--mute)">The link opens a private copy of the ${nice} that your client can view and save as PDF — no login needed. Anyone with the link can see it, so share it only with the client.</small><div class="err" id="fe"></div></div>
    <footer><button class="btn ghost" id="cp">Copy link</button><button class="btn" id="go">Open WhatsApp</button></footer></div>`;
  document.body.append(ov);
  $('#x', ov).onclick = () => ov.remove(); ov.onmousedown = (e) => { if (e.target === ov) ov.remove(); };
  $('#cp', ov).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link); } };
  $('#go', ov).onclick = async () => {
    const n = waNumber($('#ph', ov).value);
    if (n.length < 11) { $('#fe', ov).textContent = 'Enter the number with country code, e.g. 919876543210'; return; }
    window.open(`https://wa.me/${n}?text=${encodeURIComponent($('#msg', ov).value)}`, '_blank');
    if ($('#ms', ov)?.checked) { try { await api(`/e/${isQ ? 'quotes' : 'invoices'}/${doc.id}`, { method: 'PUT', body: { ...doc, status: 'Sent' } }); toast('Marked as Sent'); } catch {} }
    ov.remove(); route();
  };
}

async function openEmail(doc, kind) {
  const isQ = kind === 'quote';
  if (!doc.share_token) throw new Error('Sharing is not set up yet — run migration 006 in Supabase');
  let who = {};
  try { who = (await api('/e/clients')).find((c) => String(c.id) === String(doc.client_id)) || {}; } catch {}
  if (!who.name && doc.lead_id) { try { const l = (await api('/e/leads')).find((x) => String(x.id) === String(doc.lead_id)); who = { name: l?.company || l?.name, contact_person: l?.name, email: l?.email }; } catch {} }
  const link = shareLink(kind, doc.share_token), nice = isQ ? 'Quotation' : 'Invoice';
  const due = !isQ && doc.due_date ? ` It is due by ${new Date(doc.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}.` : '';
  const subject = `${nice} ${doc.number} — Redeye Digital Solutions`;
  const body = `Hello ${who.contact_person || who.name || ''},\n\nPlease find ${nice.toLowerCase()} ${doc.number} for ${money2(doc.total)}.${due}\n\nView / download PDF: ${link}\n\nIf you have any questions, just reply to this email.\n\nRegards,\n${meta.user.name}\nRedeye Digital Solutions`;
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="max-width:560px"><header><h3>📧 Send ${nice.toLowerCase()} by email</h3><button class="btn ghost sm" id="x">✕</button></header>
    <div class="body" style="grid-template-columns:1fr"><div><label>To</label><input id="to" type="email" value="${esc(who.email || '')}" placeholder="client@example.com"></div>
    <div><label>Subject</label><input id="sj" value="${esc(subject)}"></div>
    <div><label>Message</label><textarea id="msg" style="min-height:200px">${esc(body)}</textarea></div>
    ${doc.status === 'Draft' ? '<label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink)"><input type="checkbox" id="ms" checked style="width:auto"> Mark as Sent after opening</label>' : ''}
    <small style="color:var(--mute)">This opens your own email so you can review and press Send. The link lets the client view and save the ${nice.toLowerCase()} as PDF without logging in.</small></div>
    <footer><button class="btn ghost" id="cp">Copy link</button><button class="btn ghost" id="app">Open mail app</button><button class="btn" id="gm">Open Gmail</button></footer></div>`;
  document.body.append(ov);
  $('#x', ov).onclick = () => ov.remove(); ov.onmousedown = (e) => { if (e.target === ov) ov.remove(); };
  $('#cp', ov).onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link); } };
  const go = async (gmail) => {
    const to = $('#to', ov).value.trim(), sj = $('#sj', ov).value, bd = $('#msg', ov).value;
    const url = gmail ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(sj)}&body=${encodeURIComponent(bd)}` : `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(sj)}&body=${encodeURIComponent(bd)}`;
    if (gmail) window.open(url, '_blank'); else location.href = url;
    if ($('#ms', ov)?.checked) { try { await api(`/e/${isQ ? 'quotes' : 'invoices'}/${doc.id}`, { method: 'PUT', body: { ...doc, status: 'Sent' } }); toast('Marked as Sent'); } catch {} }
    ov.remove(); route();
  };
  $('#gm', ov).onclick = () => go(true); $('#app', ov).onclick = () => go(false);
}
async function renderPublicDoc(kind, token) {
  $('#root').innerHTML = '<div class="login"><div class="card"><p>Loading…</p></div></div>';
  let r = null; try { r = await api('/public/doc', { method: 'POST', body: { kind, token } }); } catch {}
  if (!r) { $('#root').innerHTML = '<div class="login"><div class="card"><img class="logo" src="icons/logo.png" alt=""><h1>Link not found</h1><p>This link is invalid or no longer available. Please ask Redeye Digital Solutions for a new one.</p></div></div>'; return; }
  const html = invoiceDoc(r.doc, r.company || {}, r.client || r.lead || {}, kind === 'quote' ? 'quote' : 'invoice')
    .replace('</body>', '<style>@media print{.noprint{display:none}}</style><div class="noprint" style="position:fixed;top:12px;right:12px"><button onclick="window.print()" style="background:#e03a2f;color:#fff;border:0;border-radius:10px;padding:10px 16px;font:600 14px system-ui;cursor:pointer">⬇ Download / Print PDF</button></div></body>');
  document.open(); document.write(html); document.close();
}

// ---------- Claude assistant ----------
const ai = (task, body = {}) => api('/ai', { method: 'POST', body: { task, ...body } });
async function aiRun(btn, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = '✨ Thinking…';
  try { await fn(); } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.textContent = old; }
}
const clientById = async (id) => (id ? (await api('/e/clients')).find((c) => String(c.id) === String(id)) || {} : {});

function aiPreview(title, listHtml, applyLabel, apply) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="max-width:720px"><header><h3>${esc(title)}</h3><button class="btn ghost sm" id="x">✕</button></header><div class="body" style="grid-template-columns:1fr"><div class="pick" style="max-height:60vh">${listHtml}</div></div>
    <footer><span id="fe" class="err" style="flex:1;margin:0;align-self:center"></span><button class="btn ghost" id="no">Cancel</button><button class="btn" id="ok">${esc(applyLabel)}</button></footer></div>`;
  document.body.append(ov);
  const close = () => ov.remove();
  $('#x', ov).onclick = close; $('#no', ov).onclick = close; ov.onmousedown = (e) => { if (e.target === ov) close(); };
  $('#ok', ov).onclick = async (e) => {
    e.target.disabled = true;
    try { await apply([...ov.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value)); close(); } catch (err) { $('#fe', ov).textContent = err.message; e.target.disabled = false; }
  };
}

ACTIONS.ai_plan_ideas = {
  label: '✨ Fill ideas with Claude',
  async run(plan, ctx) {
    const items = (await api('/e/content_items')).filter((i) => String(i.plan_id) === String(plan.id));
    const empty = items.filter((i) => i.status === 'Idea' && !i.concept);
    if (!empty.length) return toast('No empty slots in this plan. Use “Generate content calendar” first, or all ideas are already filled.');
    const r = await ai('ideas', { client: await clientById(plan.client_id), plan: { month: plan.month, objective: plan.objective, themes: plan.themes }, items: empty, used: items.filter((i) => i.concept).map((i) => i.title) });
    const byId = Object.fromEntries(empty.map((i) => [String(i.id), i]));
    const ideas = (Array.isArray(r.data) ? r.data : []).filter((x) => byId[String(x.id)]);
    if (!ideas.length) throw new Error('Claude returned no usable ideas, please try again');
    aiPreview(`Ideas for ${ideas.length} slots`, ideas.map((x) => { const s = byId[String(x.id)]; return `<label><input type="checkbox" value="${esc(x.id)}" checked><span><b>${esc(x.title)}</b> <small>· ${esc(s.publish_date || '')} · ${esc(s.format || '')} · ${esc(s.platform || '')}</small><br><small>${esc(x.concept)}</small></span></label>`; }).join(''),
      'Add selected to calendar', async (ids) => {
        for (const id of ids) { const x = ideas.find((i) => String(i.id) === String(id)); await api(`/e/content_items/${id}`, { method: 'PUT', body: { ...byId[String(id)], title: x.title, concept: x.concept } }); }
        ctx.close(); toast(`${ids.length} ideas added`); location.hash = '#/content_items'; route();
      });
  },
};

async function aiShootPlan(after) {
  const [items, shoots] = await Promise.all([api('/e/content_items'), api('/e/shoots')]);
  const todo = items.filter((i) => PRE_SHOOT.includes(i.status) && !i.shoot_id);
  if (!todo.length) return toast('Nothing waiting to be shot. Plan content first.');
  await lookup('clients');
  const r = await ai('shoot_plan', { today: today(), lead_days: 5, max_per_shoot: 6,
    items: todo.map((i) => ({ ...i, client: lbl('clients', i.client_id) })),
    booked: shoots.filter((s) => s.status !== 'Cancelled' && s.shoot_date >= today()).map((s) => ({ client_id: s.client_id, date: s.shoot_date })) });
  const plan = (Array.isArray(r.data) ? r.data : []).filter((s) => s.date && Array.isArray(s.item_ids) && s.item_ids.length);
  if (!plan.length) throw new Error('Claude returned no usable plan, please try again');
  const title = (s) => s.title || `${lbl('clients', s.client_id)} shoot`;
  aiPreview(`Proposed shoots (${plan.length})`, plan.map((s, n) => `<label><input type="checkbox" value="${n}" checked><span><b>${esc(title(s))}</b> <small>· ${esc(s.date)}${s.call_time ? ' at ' + esc(s.call_time) : ''} · ${s.item_ids.length} pieces</small><br><small>${esc(s.reason || '')}</small><br><small>${s.item_ids.map((id) => esc(todo.find((i) => String(i.id) === String(id))?.title || '#' + id)).join(' · ')}</small></span></label>`).join(''),
    'Create selected shoots', async (picked) => {
      for (const n of picked) {
        const s = plan[+n], shoot = await api('/e/shoots', { method: 'POST', body: { title: title(s), client_id: s.client_id, shoot_date: s.date, call_time: s.call_time, status: 'Planned', director_id: meta.user.id, notes: s.reason } });
        for (const id of s.item_ids) { const it = todo.find((i) => String(i.id) === String(id)); if (it) await api(`/e/content_items/${it.id}`, { method: 'PUT', body: { ...it, shoot_id: shoot.id, status: 'Shoot scheduled' } }); }
      }
      toast(`${picked.length} shoots created`); after();
    });
}

function aiFormTools(key, ov, ctx) {
  const box = $('#aiacts', ov); if (!box) return;
  const val = (n) => ov.querySelector(`[name=${n}]`)?.value || '';
  const put = (n, v) => { const el = ov.querySelector(`[name=${n}]`); if (el && v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
  const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.textContent = label; b.onclick = () => aiRun(b, fn); box.append(b); };
  if (key === 'content_items') {
    const item = () => ({ title: val('title'), format: val('format'), platform: val('platform'), pillar: val('pillar'), concept: val('concept'), script: val('script') });
    const plan = async () => (val('plan_id') ? (await api('/e/content_plans')).find((p) => String(p.id) === val('plan_id')) : null);
    add('✨ Write script', async () => {
      if (!val('title')) throw new Error('Give it a title first');
      const lang = prompt('Language for the script? (English / Tamil / Tanglish)', 'English'); if (lang === null) return;
      const r = await ai('script', { client: await clientById(val('client_id')), plan: await plan(), item: item(), language: lang });
      put('script', r.text); toast('Script added — review and Save');
    });
    add('✨ Caption & hashtags', async () => {
      if (!val('title')) throw new Error('Give it a title first');
      const r = await ai('caption', { client: await clientById(val('client_id')), item: item() });
      const d = r.data || {}; put('caption', d.caption || r.text); put('hashtags', d.hashtags); toast('Caption added — review and Save');
    });
  }
  if (key === 'shoots') {
    add('✨ Shot list', async () => {
      const pieces = ctx.allItems().filter((i) => ctx.picked().has(String(i.id)));
      const r = await ai('shotlist', { client: await clientById(val('client_id')), shoot: { title: val('title'), location: val('location'), call_time: val('call_time'), wrap_time: val('wrap_time'), talent: val('talent'), props: val('props') }, pieces });
      put('shot_list', r.text); toast('Shot list added — review and Save');
    });
  }
}

// ----- Ask Claude (chat) -----
let chatLog = [];
async function assistantView(view) {
  await lookup('clients');
  const chips = ['Write a 30-second reel script for', 'Give me 10 reel ideas for', 'Draft a one-month content plan for', 'Write a client update message about', 'Suggest a shoot-day schedule for'];
  view.innerHTML = `<div class="panel" style="display:flex;flex-direction:column;gap:12px;min-height:60vh">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><div style="flex:1;min-width:220px"><label>Client context (optional)</label><select id="cx"><option value="">None</option>${(lookups.clients || []).map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></div><button class="btn ghost" id="clr">New chat</button></div>
    <div id="chat" class="chat"></div>
    <div class="pipe">${chips.map((c) => `<a href="#" data-c="${esc(c)}">${esc(c)}…</a>`).join('')}</div>
    <div style="display:flex;gap:10px;align-items:flex-end"><textarea id="msg" placeholder="Ask for a script, ideas, a caption, a plan…" style="min-height:70px"></textarea><button class="btn" id="send">Send</button></div></div>`;
  const rich = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const draw = () => {
    $('#chat').innerHTML = chatLog.map((m, i) => `<div class="m ${m.role}"><div>${rich(m.content)}</div>${m.role === 'assistant' ? `<button class="btn ghost sm" data-cp="${i}">Copy</button>` : ''}</div>`).join('') || '<div class="empty" style="padding:24px">Ask me for scripts, content ideas, captions, client messages or shoot plans. Pick a client above so I know their brand.</div>';
    $('#chat').scrollTop = 1e9;
    view.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(chatLog[b.dataset.cp].content); toast('Copied'); } catch { toast('Select the text to copy'); } }));
  };
  const context = async () => {
    const id = $('#cx').value; if (!id) return '';
    const c = await clientById(id), [items, shoots, pk] = await Promise.all([api('/e/content_items').catch(() => []), api('/e/shoots').catch(() => []), api('/e/packages').catch(() => [])]);
    const mine = items.filter((i) => String(i.client_id) === id).slice(0, 30).map((i) => `${i.publish_date || 'undated'} ${i.format || ''} "${i.title}" [${i.status}]`).join('\n');
    return `${brandLine(c)}\nPackage: ${pk.filter((p) => String(p.client_id) === id && p.status === 'Active').map((p) => `${p.name} (${p.videos_per_month ?? '?'} videos, ${p.posts_per_month ?? '?'} posts / month)`).join('; ') || 'n/a'}\nUpcoming shoots: ${shoots.filter((s) => String(s.client_id) === id && s.shoot_date >= today()).map((s) => `${s.shoot_date} ${s.title}`).join('; ') || 'none'}\nContent items:\n${mine || 'none'}`;
  };
  const brandLine = (c) => `Client: ${c.name || ''}\nBrand notes: ${c.brand_notes || 'none'}\nSocial handles: ${c.social_handles || 'n/a'}`;
  const send = async () => {
    const t = $('#msg').value.trim(); if (!t) return;
    chatLog.push({ role: 'user', content: t }); $('#msg').value = ''; draw();
    const b = $('#send'); b.disabled = true; b.textContent = '…';
    try { const r = await ai('chat', { messages: chatLog, context: await context() }); chatLog.push({ role: 'assistant', content: r.text }); }
    catch (err) { chatLog.pop(); $('#msg').value = t; toast(err.message); }
    b.disabled = false; b.textContent = 'Send'; draw();
  };
  $('#send').onclick = send;
  $('#msg').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); };
  $('#clr').onclick = () => { chatLog = []; draw(); };
  view.querySelectorAll('[data-c]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); $('#msg').value = a.dataset.c + ' '; $('#msg').focus(); }));
  draw();
}


// ---------- sharing helpers ----------
function inWords(n) {
  n = Math.round(+n || 0);
  if (n === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const parts = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']];
  let out = '';
  for (const [v, l] of parts) { if (n >= v) { out += three(Math.floor(n / v)) + ' ' + l + ' '; n %= v; } }
  return (out + (n ? three(n) : '')).trim();
}
const appBase = () => `${location.origin}${location.pathname}`;
const NICE_DATE = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// One modal for sending a link by WhatsApp, Gmail or copy. opts: title, phone, email, subject, message, link, markLabel, onSent
function shareModal(o) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="max-width:560px"><header><h3>${esc(o.title)}</h3><button class="btn ghost sm" id="x">✕</button></header>
    <div class="body" style="grid-template-columns:1fr">
      <div><label>WhatsApp number (with country code)</label><input id="ph" type="tel" value="${esc(waNumber(o.phone))}" placeholder="91XXXXXXXXXX"></div>
      <div><label>Email (optional)</label><input id="em" type="email" value="${esc(o.email || '')}" placeholder="client@example.com"></div>
      <div><label>Message</label><textarea id="msg" style="min-height:170px">${esc(o.message)}</textarea></div>
      ${o.markLabel ? `<label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink)"><input type="checkbox" id="ms" checked style="width:auto"> ${esc(o.markLabel)}</label>` : ''}
      ${o.link ? '<small style="color:var(--mute)">Anyone with the link can open it, so send it only to the client.</small>' : ''}<div class="err" id="fe"></div></div>
    <footer>${o.link ? '<button class="btn ghost" id="cp">Copy link</button>' : ''}<button class="btn ghost" id="gm">Open Gmail</button><button class="btn" id="go">Open WhatsApp</button></footer></div>`;
  document.body.append(ov);
  const close = () => ov.remove();
  $('#x', ov).onclick = close; ov.onmousedown = (e) => { if (e.target === ov) close(); };
  if (o.link) $('#cp', ov).onclick = async () => { try { await navigator.clipboard.writeText(o.link); toast('Link copied'); } catch { toast(o.link); } };
  const sent = async () => { if ($('#ms', ov)?.checked && o.onSent) { try { await o.onSent(); } catch {} } close(); };
  $('#go', ov).onclick = () => {
    const n = waNumber($('#ph', ov).value);
    if (n.length < 11) { $('#fe', ov).textContent = 'Enter the number with country code, e.g. 919876543210'; return; }
    window.open(`https://wa.me/${n}?text=${encodeURIComponent($('#msg', ov).value)}`, '_blank'); sent();
  };
  $('#gm', ov).onclick = () => {
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent($('#em', ov).value.trim())}&su=${encodeURIComponent(o.subject || o.title)}&body=${encodeURIComponent($('#msg', ov).value)}`, '_blank'); sent();
  };
}
const contactOf = async (clientId) => { const c = await clientById(clientId); return { name: c.contact_person || c.name || '', phone: c.phone, email: c.email, company: c.name }; };

// ---------- public (no-login) pages: approvals, client portal, contracts ----------
const pubShell = (html) => { window._pub = true; $('#root').innerHTML = `<div class="pubwrap"><div class="pub"><div class="pubhd"><img src="icons/logo.png" alt="Redeye Digital Solutions"></div>${html}<p class="pubft">Powered by Redeye Digital Solutions</p></div></div>`; };
const pubError = () => pubShell('<div class="panel" style="text-align:center"><h2>Link not found</h2><p>This link is invalid or no longer available. Please ask Redeye Digital Solutions for a new one.</p></div>');
const nlbr = (t) => esc(t || '').replace(/\n/g, '<br>');

async function renderApproval(kind, token) {
  pubShell('<p>Loading…</p>');
  let r = null; try { r = await api('/public/approval', { method: 'POST', body: { kind, token } }); } catch {}
  if (!r) return pubError();
  const saved = (() => { try { return localStorage.getItem('approver') || ''; } catch { return ''; } })();
  const card = (it) => `<div class="panel pc" data-id="${it.id}">
    <div class="pch"><b>${esc(it.title)}</b><span class="st">${tag(it.client_status && it.client_status !== 'Not sent' ? it.client_status : it.status)}</span></div>
    <div class="pm">${esc([it.format, it.platform, it.publish_date && 'Going live ' + NICE_DATE(it.publish_date), it.publish_time].filter(Boolean).join(' · '))}</div>
    ${it.concept ? `<p>${nlbr(it.concept)}</p>` : ''}
    ${it.script ? `<details><summary>View script</summary><div class="pbox">${nlbr(it.script)}</div></details>` : ''}
    ${it.caption ? `<div class="pbox"><small>Caption</small><br>${nlbr(it.caption)}${it.hashtags ? `<br><span style="color:var(--mute)">${esc(it.hashtags)}</span>` : ''}</div>` : ''}
    ${it.asset_link ? `<p><a class="btn ghost" href="${esc(it.asset_link)}" target="_blank" rel="noopener">▶ Watch / view the file</a></p>` : ''}
    ${it.client_feedback ? `<div class="pbox"><small>Earlier notes</small><br>${nlbr(it.client_feedback)}</div>` : ''}
    <div class="pact"><button class="btn" data-ok="${it.id}">✅ Approve</button><button class="btn ghost" data-chg="${it.id}">✏️ Request changes</button></div>
    <div class="pchg" hidden><textarea placeholder="What should we change?"></textarea><button class="btn sm" data-send="${it.id}">Send</button></div><div class="err"></div></div>`;
  pubShell(`<h1 class="ph1">${kind === 'plan' ? esc(r.plan?.title || 'Content plan') : 'Please review'}</h1>
    <p class="pm">${esc(r.client?.name || '')}${kind === 'plan' && r.plan?.month ? ' · ' + esc(r.plan.month) : ''}</p>
    ${kind === 'plan' && r.plan?.objective ? `<div class="pbox">${nlbr(r.plan.objective)}</div>` : ''}
    <div class="panel"><label>Your name</label><input id="who" value="${esc(saved)}" placeholder="So we know who replied"></div>
    ${kind === 'plan' && r.items.length > 1 ? '<p><button class="btn" id="all">✅ Approve everything</button></p>' : ''}
    <div id="cards">${r.items.map(card).join('') || '<p>Nothing to review right now.</p>'}</div>`);
  const who = () => { const v = $('#who').value.trim(); try { localStorage.setItem('approver', v); } catch {} return v; };
  const send = async (id, decision, comment, cardEl) => {
    const e = $('.err', cardEl); e.textContent = '';
    if (!who()) { e.textContent = 'Please enter your name above'; return false; }
    try {
      const res = await api('/public/respond', { method: 'POST', body: { kind, token, item_id: +id, decision, who: who(), comment } });
      $('.st', cardEl).innerHTML = tag(decision === 'approve' ? 'Approved' : 'Changes requested');
      $('.pact', cardEl).innerHTML = `<b style="color:var(--${decision === 'approve' ? 'ok' : 'warn'})">${decision === 'approve' ? '✅ Approved, thank you!' : '✏️ Sent to the team, thank you!'}</b>`;
      $('.pchg', cardEl).hidden = true; return res;
    } catch (err) { e.textContent = err.message; return false; }
  };
  document.querySelectorAll('.pc').forEach((c) => {
    const id = c.dataset.id;
    c.querySelector('[data-ok]').onclick = () => send(id, 'approve', '', c);
    c.querySelector('[data-chg]').onclick = () => { c.querySelector('.pchg').hidden = false; c.querySelector('textarea').focus(); };
    c.querySelector('[data-send]').onclick = () => send(id, 'changes', c.querySelector('textarea').value, c);
  });
  if ($('#all')) $('#all').onclick = async () => { for (const c of document.querySelectorAll('.pc')) { if (c.querySelector('[data-ok]')) await send(c.dataset.id, 'approve', '', c); } };
}

async function renderPortal(token) {
  pubShell('<p>Loading…</p>');
  let r = null; try { r = await api('/public/portal', { method: 'POST', body: { token } }); } catch {}
  if (!r) return pubError();
  const link = (p) => `${appBase()}#/${p}`;
  const needs = r.upcoming.filter((i) => i.status === 'Client review' || i.client_status === 'Sent to client');
  const num = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
  const bal = (i) => (+i.total || 0) - (+i.amount_paid || 0);
  pubShell(`<h1 class="ph1">${esc(r.client.name)}</h1><p class="pm">Your content and billing with ${esc(r.company.name)}</p>
    ${needs.length ? `<div class="panel" style="border-color:var(--brand)"><h3>⏳ Waiting for your approval (${needs.length})</h3>${needs.map((i) => `<div class="row"><span>${esc(i.title)}<br><small style="color:var(--mute)">${esc([i.format, i.platform, i.publish_date && NICE_DATE(i.publish_date)].filter(Boolean).join(' · '))}</small></span><a class="btn sm" href="${link('approve/item/' + i.share_token)}">Review</a></div>`).join('')}</div>` : ''}
    ${r.package ? `<div class="panel"><h3>📦 Your package</h3>${esc(r.package.name)}${r.package.videos ? ` · ${r.package.videos} videos / month` : ''}${r.package.posts ? ` · ${r.package.posts} posts / month` : ''}</div>` : ''}
    <div class="panel"><h3>🗓 Coming up</h3>${r.upcoming.map((i) => `<div class="row"><span>${esc(i.title)}<br><small style="color:var(--mute)">${esc([i.format, i.platform, i.publish_date && NICE_DATE(i.publish_date)].filter(Boolean).join(' · '))}</small></span>${tag(i.client_status === 'Approved' ? 'Approved' : i.status)}</div>`).join('') || '<p style="color:var(--mute)">Nothing scheduled yet.</p>'}</div>
    ${r.shoots.length ? `<div class="panel"><h3>🎬 Upcoming shoots</h3>${r.shoots.map((s) => `<div class="row"><span>${esc(s.title)}<br><small style="color:var(--mute)">${esc(NICE_DATE(s.date))}${s.call_time ? ' · ' + esc(s.call_time) : ''}${s.location ? ' · ' + esc(s.location) : ''}</small></span>${tag(s.status)}</div>`).join('')}</div>` : ''}
    <div class="panel"><h3>📈 Recently published</h3>${r.published.map((p) => `<div class="row"><span>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}<br><small style="color:var(--mute)">${esc([p.platform, NICE_DATE(p.date)].filter(Boolean).join(' · '))}</small></span><span style="text-align:right;font-size:12px;color:var(--mute)">${num(p.views)} views<br>${num(p.likes)} likes · ${num(p.comments)} comments</span></div>`).join('') || '<p style="color:var(--mute)">Results will appear here after your posts go live.</p>'}</div>
    <div class="panel"><h3>🧾 Invoices</h3>${r.invoices.map((i) => `<div class="row"><span><a href="${link('view/inv/' + i.share_token)}">${esc(i.number)}</a><br><small style="color:var(--mute)">${esc(NICE_DATE(i.issue_date))}${i.due_date ? ' · due ' + esc(NICE_DATE(i.due_date)) : ''}</small></span><span style="text-align:right">${money(i.total)}<br>${i.status === 'Paid' ? tag('Paid') : `${tag(i.status)} <small>balance ${money(bal(i))}</small>`}</span></div>`).join('') || '<p style="color:var(--mute)">No invoices yet.</p>'}</div>
    <p class="pubft">Questions? ${esc(r.company.email || '')} ${esc(r.company.phone || '')}</p>`);
}

async function renderContractPage(token) {
  pubShell('<p>Loading…</p>');
  let r = null; try { r = await api('/public/contract', { method: 'POST', body: { token } }); } catch {}
  if (!r) return pubError();
  const k = r.contract, signed = k.status === 'Signed';
  pubShell(`<h1 class="ph1">${esc(k.title)}</h1><p class="pm">Between ${esc(r.company.name)} and ${esc(r.client?.name || 'the client')}</p>
    <div class="panel"><div class="contract">${nlbr(k.body)}</div></div>
    ${signed ? `<div class="panel" style="border-color:var(--ok)"><h3>✅ Signed</h3>Signed electronically by <b>${esc(k.signed_name)}</b> on ${esc(new Date(k.signed_at).toLocaleString('en-GB'))}.</div>`
      : `<div class="panel"><h3>Sign this agreement</h3><label>Type your full name</label><input id="sn" autocomplete="name" placeholder="Your full name">
         <label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink);margin-top:12px"><input type="checkbox" id="ag" style="width:auto;margin-top:3px"> I have read the agreement and agree to it. Typing my name is my electronic signature.</label>
         <div class="err" id="se"></div><button class="btn" id="sg">Sign</button></div>`}
    <p><button class="btn ghost" onclick="window.print()">⬇ Download / Print</button></p>`);
  if ($('#sg')) $('#sg').onclick = async () => {
    if (!$('#ag').checked) { $('#se').textContent = 'Please tick the box to agree'; return; }
    try { await api('/public/sign', { method: 'POST', body: { token, who: $('#sn').value } }); renderContractPage(token); } catch (err) { $('#se').textContent = err.message; }
  };
}

// ---------- payments, receipts, contracts, approvals, templates, payouts ----------
const balanceOf = (inv) => Math.max((+inv.total || 0) - (+inv.amount_paid || 0), 0);
const paidBadge = (inv) => (inv.status === 'Paid' ? 'Paid' : balanceOf(inv) < (+inv.total || 0) ? 'Partial' : inv.status);

function formModal(title, fieldsHtml, okLabel, onSubmit) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<form class="modal" style="max-width:520px"><header><h3>${esc(title)}</h3><button type="button" class="btn ghost sm" id="x">✕</button></header><div class="body">${fieldsHtml}</div>
    <footer><span id="fe" class="err" style="flex:1;margin:0;align-self:center"></span><button class="btn">${esc(okLabel)}</button></footer></form>`;
  document.body.append(ov);
  const close = () => ov.remove(); $('#x', ov).onclick = close; ov.onmousedown = (e) => { if (e.target === ov) close(); };
  ov.querySelector('form').onsubmit = async (e) => { e.preventDefault(); try { await onSubmit(Object.fromEntries(new FormData(e.target)), close); } catch (err) { $('#fe', ov).textContent = err.message; } };
  return ov;
}
const userOpts = (sel) => `<option value=""></option>${(lookups.users || []).map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}`;

ACTIONS.record_payment = {
  label: '💵 Record payment',
  async run(inv, ctx) {
    formModal(`Record payment · ${inv.number}`, `<div class="full"><small style="color:var(--mute)">Invoice total ${money2(inv.total)} · received ${money2(inv.amount_paid)} · balance <b>${money2(balanceOf(inv))}</b></small></div>
      <div><label>Amount received *</label><input name="amount" type="number" step="any" value="${balanceOf(inv) || ''}" required></div>
      <div><label>Received on</label><input name="paid_on" type="date" value="${today()}"></div>
      <div><label>Method</label><select name="method">${['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'].map((m) => `<option>${m}</option>`).join('')}</select></div>
      <div><label>Reference / UTR</label><input name="reference"></div>`, 'Save payment', async (f, close) => {
      if (!(+f.amount > 0)) throw new Error('Enter the amount received');
      await api('/e/payments', { method: 'POST', body: { invoice_id: inv.id, amount: +f.amount, paid_on: f.paid_on || today(), method: f.method, reference: f.reference } });
      close(); ctx.close(); toast('Payment recorded'); ctx.after();
    });
  },
};
ACTIONS.whatsapp_reminder = {
  label: '⏰ Payment reminder',
  async run(inv, ctx) {
    if (inv.status === 'Paid') return toast('This invoice is already paid');
    if (!inv.share_token) throw new Error('Sharing is not set up yet');
    const c = await contactOf(inv.client_id), late = inv.due_date && inv.due_date < today();
    shareModal({ title: `Payment reminder · ${inv.number}`, phone: c.phone, email: c.email, subject: `Payment reminder — ${inv.number}`, link: shareLink('inv', inv.share_token),
      message: `Hello ${c.name},\n\nA gentle reminder that invoice ${inv.number} for ${money2(inv.total)}${inv.amount_paid > 0 ? ` (balance ${money2(balanceOf(inv))})` : ''} ${late ? `was due on ${NICE_DATE(inv.due_date)}` : inv.due_date ? `is due on ${NICE_DATE(inv.due_date)}` : 'is pending'}.\n\nView / download: ${shareLink('inv', inv.share_token)}\n\nPlease share the payment confirmation once done. Thank you!\nRedeye Digital Solutions` });
  },
};
ACTIONS.receipt = {
  label: '🧾 Print receipt',
  run: (pay) => printDoc(`Receipt ${pay.id}`, async () => {
    const [invs, cs, co] = await Promise.all([api('/e/invoices'), api('/e/clients'), api('/company').catch(() => ({}))]);
    const inv = invs.find((i) => String(i.id) === String(pay.invoice_id)) || {}, c = cs.find((x) => String(x.id) === String(inv.client_id)) || {};
    return `<h1>PAYMENT RECEIPT</h1>${kv([['Receipt no.', 'RC-' + String(pay.id).padStart(4, '0')], ['Date', esc(NICE_DATE(pay.paid_on))], ['Received from', esc(c.name)], ['Towards invoice', esc(inv.number)], ['Amount', `<b>${money2(pay.amount)}</b>`], ['In words', `Rupees ${esc(inWords(pay.amount))} only`], ['Method', esc(pay.method)], ['Reference', esc(pay.reference)], ['Invoice total', money2(inv.total)], ['Balance after this payment', money2(Math.max((+inv.total || 0) - (+inv.amount_paid || 0), 0))]])}
      <p style="margin-top:40px">For ${esc(co.name || 'Redeye Digital Solutions')}<br><br><b>${esc(co.signatory || 'Authorized Signatory')}</b></p>`;
  }),
};
ACTIONS.share_contract = {
  label: '💬 Send for signature',
  async run(k, ctx) {
    if (!k.share_token) throw new Error('Sharing is not set up yet');
    if (k.status === 'Signed') return toast('Already signed');
    const c = await contactOf(k.client_id), link = `${appBase()}#/view/contract/${k.share_token}`;
    shareModal({ title: `Send contract · ${k.title}`, phone: c.phone, email: c.email, subject: k.title, link, markLabel: 'Mark as Sent', onSent: async () => { if (k.status === 'Draft') await api(`/e/contracts/${k.id}`, { method: 'PUT', body: { ...k, status: 'Sent' } }); ctx.after(); },
      message: `Hello ${c.name},\n\nPlease review and sign our agreement online: ${k.title}\n\n${link}\n\nYou can sign by typing your name, no printing needed. Thank you!\nRedeye Digital Solutions` });
  },
};
ACTIONS.print_contract = {
  label: '🖨 Print',
  run: (k) => printDoc(k.title, async () => `<h1>${esc(k.title)}</h1><pre style="margin-top:14px">${esc(k.body)}</pre>${k.status === 'Signed' ? `<p style="margin-top:30px"><b>Signed electronically by ${esc(k.signed_name)}</b> on ${esc(new Date(k.signed_at).toLocaleString('en-GB'))}</p>` : '<p style="margin-top:50px">Signature: ______________________ &nbsp;&nbsp; Date: ____________</p>'}`),
};
ACTIONS.share_portal = {
  label: '🔗 Client portal link',
  async run(c) {
    if (!c.portal_token) throw new Error('Sharing is not set up yet');
    const link = `${appBase()}#/portal/${c.portal_token}`;
    shareModal({ title: `Client portal · ${c.name}`, phone: c.phone, email: c.email, subject: `Your content portal — Redeye Digital Solutions`, link,
      message: `Hello ${c.contact_person || c.name},\n\nHere is your private portal with Redeye. You can see upcoming content, approve posts, check results and view invoices:\n\n${link}\n\nThank you!\nRedeye Digital Solutions` });
  },
};
ACTIONS.approval_link = {
  label: '✅ Send for approval',
  async run(it, ctx) {
    if (!it.share_token) throw new Error('Sharing is not set up yet');
    const c = await contactOf(it.client_id), link = `${appBase()}#/approve/item/${it.share_token}`;
    shareModal({ title: `Approval · ${it.title}`, phone: c.phone, email: c.email, subject: `Please approve: ${it.title}`, link, markLabel: 'Mark as sent to client',
      onSent: async () => { await api(`/e/content_items/${it.id}`, { method: 'PUT', body: { ...it, client_status: 'Sent to client', status: ['Internal review', 'Editing'].includes(it.status) ? 'Client review' : it.status } }); ctx.after(); },
      message: `Hello ${c.name},\n\nPlease review "${it.title}"${it.publish_date ? ` (planned for ${NICE_DATE(it.publish_date)})` : ''} and tap Approve, or tell us what to change:\n\n${link}\n\nThank you!\nRedeye Digital Solutions` });
  },
};
ACTIONS.plan_approval_link = {
  label: '✅ Send plan for approval',
  async run(plan, ctx) {
    if (!plan.share_token) throw new Error('Sharing is not set up yet');
    const c = await contactOf(plan.client_id), link = `${appBase()}#/approve/plan/${plan.share_token}`;
    shareModal({ title: `Plan approval · ${plan.title}`, phone: c.phone, email: c.email, subject: `Content plan for approval — ${plan.title}`, link, markLabel: 'Mark plan as Pending approval',
      onSent: async () => { await api(`/e/content_plans/${plan.id}`, { method: 'PUT', body: { ...plan, status: 'Pending approval' } }); ctx.after(); },
      message: `Hello ${c.name},\n\nHere is the content plan for ${plan.month} (${plan.title}). Please review each idea and approve, or tell us what to change:\n\n${link}\n\nThank you!\nRedeye Digital Solutions` });
  },
};
ACTIONS.post_pack = {
  label: '📤 Posting pack',
  async run(it, ctx) {
    const text = [it.caption, it.hashtags].filter(Boolean).join('\n\n');
    if (text) { try { await navigator.clipboard.writeText(text); toast('Caption and hashtags copied. Paste them into the post.'); } catch { toast('Could not copy automatically'); } } else toast('No caption yet');
    if (it.asset_link) window.open(it.asset_link, '_blank');
    if (confirm('Mark this piece as Published now?')) {
      const url = prompt('Link to the live post (optional)', it.posted_url || '') ?? '';
      await api(`/e/content_items/${it.id}`, { method: 'PUT', body: { ...it, status: 'Published', posted_on: today(), posted_url: url || it.posted_url } });
      ctx.close(); toast('Marked as Published'); ctx.after();
    }
  },
};
ACTIONS.mark_returned = {
  label: '↩ Mark returned',
  async run(log, ctx) {
    if (log.returned_on) return toast('Already returned');
    const cond = prompt('Condition on return (mention any damage)', 'Good'); if (cond === null) return;
    await api(`/e/equipment_log/${log.id}`, { method: 'PUT', body: { ...log, returned_on: today(), condition_in: cond } });
    ctx.close(); toast('Marked as returned'); ctx.after();
  },
};
ACTIONS.apply_template = {
  label: '📋 Apply task template',
  async run(row, ctx) {
    const templates = await api('/e/task_templates'); await lookup('users');
    if (!templates.length) return toast('No templates yet. Create one under Delivery → Task templates.');
    const isShoot = ctx.key === 'shoots';
    const start = isShoot ? row.shoot_date || today() : today();
    formModal(`Apply a template to “${row.name || row.title}”`, `<div class="full"><label>Template</label><select name="tpl">${templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div><label>Start date${isShoot ? ' (shoot date)' : ''}</label><input name="start" type="date" value="${start}"></div>
      <div><label>Assign tasks to</label><select name="who">${userOpts(meta.user.id)}</select></div>`, 'Create tasks', async (f, close) => {
      const t = templates.find((x) => String(x.id) === f.tpl), items = arr(t.items), base = new Date((f.start || today()) + 'T00:00:00'), prefix = row.name || row.title;
      for (const it of items) { const d = new Date(base); d.setDate(d.getDate() + (+it.days || 0));
        await api('/e/tasks', { method: 'POST', body: { title: `${prefix}: ${it.title}`, project_id: ctx.key === 'projects' ? row.id : undefined, assignee_id: f.who || meta.user.id, priority: it.priority || 'Medium', status: 'To do', due_date: iso(d) } }); }
      close(); ctx.close(); toast(`${items.length} tasks created`); location.hash = '#/tasks';
    });
  },
};
ACTIONS.freelancer_ledger = {
  label: '💼 Payouts',
  async run(fl) {
    await lookup('clients');
    const draw = async () => {
      const rows = (await api('/e/expenses')).filter((e) => String(e.freelancer_id) === String(fl.id)), total = rows.filter((e) => e.status !== 'Rejected').reduce((a, e) => a + (+e.amount || 0), 0);
      return { rows, total };
    };
    const { rows, total } = await draw();
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="modal" style="max-width:640px"><header><h3>💼 Payouts · ${esc(fl.name)}</h3><button class="btn ghost sm" id="x">✕</button></header><div class="body" style="grid-template-columns:1fr">
      <div><b>Total paid to date: ${money2(total)}</b></div>
      <div class="tw"><table><thead><tr><th>Date</th><th>For</th><th>Client</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.description)}</td><td>${esc(lbl('clients', e.client_id))}</td><td>${money2(e.amount)}</td><td>${tag(e.status)}</td></tr>`).join('') || '<tr><td colspan="5" style="color:var(--mute)">No payouts yet</td></tr>'}</tbody></table></div></div>
      <footer><button class="btn" id="np">+ Record payout</button></footer></div>`;
    document.body.append(ov); $('#x', ov).onclick = () => ov.remove(); ov.onmousedown = (e) => { if (e.target === ov) ov.remove(); };
    $('#np', ov).onclick = () => { ov.remove(); formModal(`Payout to ${fl.name}`, `<div><label>Amount *</label><input name="amount" type="number" step="any" required></div><div><label>Date</label><input name="date" type="date" value="${today()}"></div>
      <div class="full"><label>For (shoot / work)</label><input name="description" value="${esc(fl.role || '')} — " required></div><div class="full"><label>Charge to client</label><select name="client_id"><option value=""></option>${(lookups.clients || []).map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></div>`, 'Save payout', async (f, close) => {
      await api('/e/expenses', { method: 'POST', body: { date: f.date, category: 'Freelancers', description: f.description, amount: +f.amount, client_id: f.client_id || undefined, freelancer_id: fl.id, status: 'Approved' } }); close(); toast('Payout recorded'); }); };
  },
};

// ---------- comments & files inside a record ----------
const COMMENTABLE = new Set(['leads', 'content_items', 'shoots', 'tasks', 'projects', 'clients', 'contracts', 'meetings']);
const ATTACHABLE = new Set(['leads', 'clients', 'projects', 'content_items', 'shoots', 'tasks', 'contracts', 'meetings', 'freelancers', 'invoices', 'quotes']);
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const agoText = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); };

async function renderExtras(ov, key, row) {
  const box = $('#extras', ov); if (!box) return;
  box.innerHTML = `${key === 'leads' ? '<div class="sec" style="margin:0">Activity</div><div id="tl"></div>' : ''}${COMMENTABLE.has(key) ? '<div class="sec" style="margin:0">Comments</div><div id="cm" class="cmlist"></div>' : ''}${ATTACHABLE.has(key) ? '<div class="sec" style="margin:14px 0 0">Files</div><div id="at"></div>' : ''}`;
  const names = (lookups.users || []);
  if (key === 'leads') drawTimeline($('#tl', box), row);
  if (COMMENTABLE.has(key)) {
    const drawC = async () => {
      let list = []; try { list = await api('/comments', { body: { entity: key, record_id: row.id } }); } catch (err) { $('#cm', box).innerHTML = `<small style="color:var(--mute)">${esc(err.message)}</small>`; return; }
      const mark = (t) => esc(t).replace(/(@[\wÀ-ÿ]+(?: [\wÀ-ÿ]+)?)/g, (m) => (names.some((u) => m.toLowerCase().startsWith('@' + u.label.toLowerCase().split(' ')[0])) ? `<b style="color:var(--brand)">${m}</b>` : m)).replace(/\n/g, '<br>');
      $('#cm', box).innerHTML = (list.map((c) => `<div class="cmt"><div><b>${esc(lbl('users', c.created_by) || 'Someone')}</b> <small style="color:var(--mute)">${esc(agoText(c.created_at))}</small>${c.created_by === meta.user.id || meta.user.role !== 'staff' ? ` <a href="#" data-dc="${c.id}" style="font-size:11px">delete</a>` : ''}</div><div>${mark(c.body)}</div></div>`).join('') || '<small style="color:var(--mute)">No comments yet</small>')
        + `<div class="cmnew"><textarea id="cb" placeholder="Write a comment…" style="min-height:60px"></textarea><div style="display:flex;gap:8px;align-items:center;margin-top:6px"><select id="mn" style="width:auto"><option value="">@ Mention…</option>${names.map((u) => `<option value="${esc(u.label)}">${esc(u.label)}</option>`).join('')}</select><span style="flex:1"></span><button type="button" class="btn sm" id="cs">Post</button></div></div>`;
      $('#mn', box).onchange = (e) => { if (e.target.value) { $('#cb', box).value += `${$('#cb', box).value && !/\s$/.test($('#cb', box).value) ? ' ' : ''}@${e.target.value} `; e.target.value = ''; $('#cb', box).focus(); } };
      $('#cs', box).onclick = async (e) => {
        const text = $('#cb', box).value.trim(); if (!text) return;
        const low = text.toLowerCase(), mentions = names.filter((u) => low.includes('@' + u.label.toLowerCase()) || low.includes('@' + u.label.toLowerCase().split(' ')[0] + ' ') || low.endsWith('@' + u.label.toLowerCase().split(' ')[0])).map((u) => u.id);
        e.target.disabled = true; try { await api('/comments', { method: 'POST', body: { entity: key, record_id: row.id, body: text, mentions } }); await drawC(); } catch (err) { toast(err.message); e.target.disabled = false; }
      };
      box.querySelectorAll('[data-dc]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); await api(`/comments/${a.dataset.dc}`, { method: 'DELETE' }); drawC(); }));
    };
    drawC();
  }
  if (ATTACHABLE.has(key)) {
    const drawA = async () => {
      let list = []; try { list = await api('/attachments', { body: { entity: key, record_id: row.id } }); } catch (err) { $('#at', box).innerHTML = `<small style="color:var(--mute)">${esc(err.message)}</small>`; return; }
      $('#at', box).innerHTML = (list.map((a) => `<div class="row"><span>📎 <a href="#" data-op="${a.id}">${esc(a.name)}</a> <small style="color:var(--mute)">${fmtSize(a.size)} · ${esc(lbl('users', a.created_by))}</small></span>${a.created_by === meta.user.id || meta.user.role !== 'staff' ? `<a href="#" data-da="${a.id}" style="font-size:12px">remove</a>` : ''}</div>`).join('') || '<small style="color:var(--mute)">No files yet</small>')
        + `<div style="margin-top:8px"><input type="file" id="fu" style="display:none" multiple><button type="button" class="btn ghost sm" id="fb">⬆ Add file</button> <small style="color:var(--mute)">up to 50 MB each. For big raw footage, paste a Drive link instead.</small></div>`;
      $('#fb', box).onclick = () => $('#fu', box).click();
      $('#fu', box).onchange = async (e) => { for (const f of e.target.files) { try { toast('Uploading ' + f.name + '…'); await api('/attachments', { method: 'POST', body: { entity: key, record_id: row.id, file: f } }); } catch (err) { toast(err.message); } } drawA(); };
      box.querySelectorAll('[data-op]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); const f = list.find((x) => String(x.id) === a.dataset.op); try { const u = await api('/attachments/url', { body: { path: f.path } }); window.open(u.url, '_blank'); } catch (err) { toast(err.message); } }));
      box.querySelectorAll('[data-da]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); if (!confirm('Remove this file?')) return; await api(`/attachments/${a.dataset.da}`, { method: 'DELETE' }); drawA(); }));
    };
    drawA();
  }
}

// checklist editor (task templates)
function checklistEditor(ov, f, row) {
  let ck = arr(row?.[f.k]).map((x) => ({ title: x.title || '', days: x.days ?? 0, priority: x.priority || 'Medium' }));
  const draw = () => {
    const box = $('#ckr', ov);
    box.innerHTML = ck.map((c, i) => `<div class="cr" style="grid-template-columns:3fr 80px 110px auto"><input data-i="${i}" data-f="title" placeholder="Task" value="${esc(c.title)}"><input data-i="${i}" data-f="days" type="number" value="${esc(c.days)}" title="Days from start"><select data-i="${i}" data-f="priority">${['Low', 'Medium', 'High', 'Urgent'].map((p) => `<option ${p === c.priority ? 'selected' : ''}>${p}</option>`).join('')}</select><button type="button" class="btn ghost sm" data-rm="${i}">✕</button></div>`).join('') || '<small style="color:var(--mute)">No tasks yet</small>';
    box.querySelectorAll('input,select').forEach((x) => (x.oninput = x.onchange = () => { ck[x.dataset.i][x.dataset.f] = x.dataset.f === 'days' ? +x.value || 0 : x.value; }));
    box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { ck.splice(b.dataset.rm, 1); draw(); }));
  };
  draw();
  if ($('#addck', ov)) $('#addck', ov).onclick = () => { ck.push({ title: '', days: 0, priority: 'Medium' }); draw(); };
  return () => ck.filter((c) => c.title.trim());
}

// ---------- custom pages ----------
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
let wlWeek = mondayOf(new Date());
async function workloadView(view) {
  const [items, shoots, tasks] = await Promise.all([api('/e/content_items'), api('/e/shoots'), api('/e/tasks'), lookup('users'), lookup('clients')]);
  const users = lookups.users || [];
  const draw = () => {
    const days = [...Array(7)].map((_, i) => new Date(wlWeek.getFullYear(), wlWeek.getMonth(), wlWeek.getDate() + i)), keys = days.map(iso), t0 = today();
    const cell = (u, k) => {
      const sh = shoots.filter((s) => s.shoot_date === k && s.status !== 'Cancelled' && (s.director_id === u || arr(s.crew_ids).includes(u)));
      const ed = items.filter((i) => i.edit_due === k && i.editor_id === u && i.status !== 'Published');
      const po = items.filter((i) => i.publish_date === k && i.owner_id === u && i.status !== 'Published');
      const tk = tasks.filter((t) => t.due_date === k && t.assignee_id === u && t.status !== 'Done');
      const chip = (ico, list, name, f) => (list.length ? `<span class="wc" title="${esc(name + ': ' + list.map(f).join(', '))}">${ico} ${list.length}</span>` : '');
      return { n: sh.length + ed.length + po.length + tk.length, html: chip('🎬', sh, 'Shoots', (s) => s.title) + chip('✂️', ed, 'Edits due', (i) => i.title) + chip('📤', po, 'Posts', (i) => i.title) + chip('✅', tk, 'Tasks due', (t) => t.title) };
    };
    const rows = users.map((u) => { const cs = keys.map((k) => cell(u.id, k)), total = cs.reduce((a, c) => a + c.n, 0), pipe = items.filter((i) => i.status !== 'Published' && [i.writer_id, i.editor_id, i.designer_id].includes(u.id)).length; return { u, cs, total, pipe }; });
    const unassigned = items.filter((i) => i.publish_date >= keys[0] && i.publish_date <= keys[6] && i.status !== 'Published' && !i.editor_id && !i.designer_id && !i.writer_id);
    $('#wl').innerHTML = `<div class="calwrap"><div class="calhd"><button class="btn ghost sm" data-w="-1">‹</button><h3>Week of ${NICE_DATE(keys[0])}</h3><button class="btn ghost sm" data-w="0">This week</button><button class="btn ghost sm" data-w="1">›</button></div>
      <table class="wl"><thead><tr><th>Team member</th>${days.map((d, i) => `<th class="${keys[i] === t0 ? 'tdy' : ''}">${DAYS[i]} ${d.getDate()}</th>`).join('')}<th>Week</th><th>In pipeline</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.u.label)}</b></td>${r.cs.map((c, i) => `<td class="${c.n >= 4 ? 'wbusy' : ''} ${keys[i] === t0 ? 'tdy' : ''}">${c.html || '<span style="color:var(--line)">·</span>'}</td>`).join('')}<td class="${r.total >= 12 ? 'wover' : ''}"><b>${r.total}</b>${r.total >= 12 ? ' ⚠️' : ''}</td><td>${r.pipe}</td></tr>`).join('')}</tbody></table>
      <p style="color:var(--mute);font-size:12px;margin:10px 0 0">🎬 shoots · ✂️ edits due · 📤 posts to publish · ✅ tasks due. Hover a number to see the items. ⚠️ = 12+ items in the week.</p></div>
      ${unassigned.length ? `<div class="panel" style="margin-top:14px"><h3>Going live this week with nobody assigned (${unassigned.length})</h3>${unassigned.map((i) => `<div class="row"><span><a href="#/content_items">${esc(i.title)}</a><br><small style="color:var(--mute)">${esc([lbl('clients', i.client_id), i.format, NICE_DATE(i.publish_date)].filter(Boolean).join(' · '))}</small></span>${tag(i.status)}</div>`).join('')}</div>` : ''}`;
    view.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => { const n = +b.dataset.w; wlWeek = n ? new Date(wlWeek.getFullYear(), wlWeek.getMonth(), wlWeek.getDate() + 7 * n) : mondayOf(new Date()); draw(); }));
  };
  view.innerHTML = '<div id="wl"></div>'; draw();
}

async function receivablesView(view) {
  const [invs, pays] = await Promise.all([api('/e/invoices'), api('/e/payments'), lookup('clients')]);
  const open = invs.filter((i) => ['Sent', 'Overdue', 'Partial'].includes(i.status) && balanceOf(i) > 0), t0 = today();
  const age = (i) => (i.due_date && i.due_date < t0 ? Math.round((new Date(t0) - new Date(i.due_date)) / 864e5) : 0);
  const sum = (a) => a.reduce((s, i) => s + balanceOf(i), 0), month = t0.slice(0, 7);
  const buckets = [['Not yet due', open.filter((i) => !age(i))], ['1–30 days late', open.filter((i) => age(i) >= 1 && age(i) <= 30)], ['31–60 days late', open.filter((i) => age(i) >= 31 && age(i) <= 60)], ['60+ days late', open.filter((i) => age(i) > 60)]];
  const byClient = {}; open.forEach((i) => (byClient[i.client_id] ||= []).push(i));
  const kpi = (t, v, s = '') => `<div class="panel kpi"><small>${t}</small><div class="v">${v}</div><div class="s">${s}</div></div>`;
  view.innerHTML = `<div class="grid">${kpi('Total outstanding', money(sum(open)), `${open.length} invoices`)}${buckets.map(([l, a]) => kpi(l, money(sum(a)), `${a.length} invoices`)).join('')}${kpi('Collected this month', money(pays.filter((p) => String(p.paid_on).startsWith(month)).reduce((s, p) => s + (+p.amount || 0), 0)), `${pays.filter((p) => String(p.paid_on).startsWith(month)).length} payments`)}</div>
    ${Object.entries(byClient).sort((a, b) => sum(b[1]) - sum(a[1])).map(([cid, list]) => `<div class="panel" style="margin-bottom:12px"><h3>${esc(lbl('clients', cid))} <span style="float:right">${money(sum(list))}</span></h3>${list.map((i) => `<div class="row"><span><a href="#" data-op="${i.id}">${esc(i.number)}</a><br><small style="color:var(--mute)">due ${esc(NICE_DATE(i.due_date) || '—')}${age(i) ? ` · <b style="color:var(--bad)">${age(i)} days late</b>` : ''}${i.amount_paid > 0 ? ' · part paid' : ''}</small></span><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><b>${money(balanceOf(i))}</b>${tag(paidBadge(i))}<button class="btn ghost sm" data-rm="${i.id}">⏰ Remind</button><button class="btn ghost sm" data-rq="${i.id}">📨 Request</button><button class="btn sm" data-pay="${i.id}">💵 Paid</button></span></div>`).join('')}</div>`).join('') || '<div class="empty">🎉 Nothing outstanding.</div>'}`;
  const find = (id) => invs.find((i) => String(i.id) === String(id));
  const after = () => route();
  view.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => ACTIONS.whatsapp_reminder.run(find(b.dataset.rm), { close() {}, after, key: 'invoices' }).catch((e) => toast(e.message))));
  view.querySelectorAll('[data-rq]').forEach((b) => (b.onclick = () => ACTIONS.payment_request.run(find(b.dataset.rq), { close() {}, after, key: 'invoices' }).catch((e) => toast(e.message))));
  view.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = () => ACTIONS.record_payment.run(find(b.dataset.pay), { close() {}, after, key: 'invoices' })));
  view.querySelectorAll('[data-op]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); form('invoices', find(a.dataset.op), after); }));
}

async function profitabilityView(view) {
  const [invs, pays, exps, projs] = await Promise.all([api('/e/invoices'), api('/e/payments'), api('/e/expenses'), api('/e/projects'), lookup('clients')]);
  const d1 = new Date(); const from0 = iso(new Date(d1.getFullYear(), d1.getMonth() - 2, 1)), to0 = today();
  view.innerHTML = `<div class="bar"><div><label>From</label><input type="date" id="pf" value="${from0}"></div><div><label>To</label><input type="date" id="pt" value="${to0}"></div></div><div id="pl"></div>`;
  const draw = () => {
    const f = $('#pf').value, t = $('#pt').value, inR = (d) => d >= f && d <= t;
    const rev = {}, cost = {}; let un = 0;
    const invClient = Object.fromEntries(invs.map((i) => [i.id, i.client_id]));
    pays.filter((p) => inR(String(p.paid_on))).forEach((p) => { const c = invClient[p.invoice_id]; rev[c] = (rev[c] || 0) + (+p.amount || 0); });
    const projClient = Object.fromEntries(projs.map((p) => [p.id, p.client_id]));
    exps.filter((e) => ['Approved', 'Reimbursed'].includes(e.status) && inR(String(e.date))).forEach((e) => { const c = e.client_id || projClient[e.project_id]; if (c) cost[c] = (cost[c] || 0) + (+e.amount || 0); else un += +e.amount || 0; });
    const ids = [...new Set([...Object.keys(rev), ...Object.keys(cost)])], rows = ids.map((id) => ({ id, name: lbl('clients', id) || 'Client #' + id, r: rev[id] || 0, c: cost[id] || 0 })).map((x) => ({ ...x, p: x.r - x.c })).sort((a, b) => b.p - a.p);
    const tr = rows.reduce((s, x) => s + x.r, 0), tc = rows.reduce((s, x) => s + x.c, 0), max = Math.max(1, ...rows.map((x) => x.r));
    $('#pl').innerHTML = `<div class="grid"><div class="panel kpi"><small>Collected</small><div class="v">${money(tr)}</div></div><div class="panel kpi"><small>Direct costs (charged to clients)</small><div class="v">${money(tc)}</div></div><div class="panel kpi"><small>Gross profit</small><div class="v" style="color:var(--${tr - tc >= 0 ? 'ok' : 'bad'})">${money(tr - tc)}</div><div class="s">${tr ? Math.round(((tr - tc) / tr) * 100) : 0}% margin</div></div><div class="panel kpi"><small>Overheads (not charged to a client)</small><div class="v">${money(un)}</div><div class="s">Net after overheads: ${money(tr - tc - un)}</div></div></div>
      <div class="tw"><table><thead><tr><th>Client</th><th>Collected</th><th>Costs</th><th>Profit</th><th>Margin</th><th style="width:30%"></th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${money(x.r)}</td><td>${money(x.c)}</td><td style="color:var(--${x.p >= 0 ? 'ok' : 'bad'})"><b>${money(x.p)}</b></td><td>${x.r ? Math.round((x.p / x.r) * 100) + '%' : '—'}</td><td><div style="height:8px;border-radius:6px;background:var(--brand);width:${Math.max(2, (x.r / max) * 100)}%;opacity:.8"></div></td></tr>`).join('') || '<tr><td colspan="6" style="color:var(--mute)">No data in this period</td></tr>'}</tbody></table></div>
      <p style="color:var(--mute);font-size:12px">Revenue = payments actually received in the period. Costs = approved expenses and freelancer payouts that are tied to a client (or to one of their projects). Tie expenses to clients to make this accurate.</p>`;
  };
  $('#pf').onchange = $('#pt').onchange = draw; draw();
}


async function companyEditor() {
  const co = await api('/company').catch(() => ({})), b = co.bank || {}, v = (x) => esc(x || '');
  formModal('Company & invoice details', `<div class="full"><label>Company name</label><input name="name" value="${v(co.name)}"></div><div class="full"><label>Tagline</label><input name="tagline" value="${v(co.tagline)}"></div>
    <div class="full"><label>Address (one line per row)</label><textarea name="address">${esc((co.address || []).join('\n'))}</textarea></div>
    <div><label>Email</label><input name="email" value="${v(co.email)}"></div><div><label>Phone</label><input name="phone" value="${v(co.phone)}"></div>
    <div><label>GSTIN (leave empty if not registered)</label><input name="gstin" value="${v(co.gstin)}"></div><div><label>Signatory name</label><input name="signatory" value="${v(co.signatory)}"></div>
    <div class="full"><label>UPI ID for payment requests (e.g. name@bank)</label><input name="upi_id" value="${v(co.upi_id)}"></div>
    <div class="sec">Bank details</div><div><label>Account holder</label><input name="holder" value="${v(b.holder)}"></div><div><label>Bank</label><input name="bank" value="${v(b.bank)}"></div>
    <div><label>Branch</label><input name="branch" value="${v(b.branch)}"></div><div><label>Account number</label><input name="account" value="${v(b.account)}"></div><div><label>IFSC</label><input name="ifsc" value="${v(b.ifsc)}"></div>`, 'Save', async (f, close) => {
    await api('/company', { method: 'PUT', body: { ...co, name: f.name, tagline: f.tagline, address: f.address.split('\n').map((x) => x.trim()).filter(Boolean), email: f.email, phone: f.phone, gstin: f.gstin, signatory: f.signatory, upi_id: f.upi_id.trim(), bank: { holder: f.holder, bank: f.bank, branch: f.branch, account: f.account, ifsc: f.ifsc } } });
    close(); toast('Saved');
  });
}

// ---------- CSV import (leads) ----------
function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '', cnt = (c) => first.split(c).length - 1;
  const d = cnt('\t') > cnt(',') && cnt('\t') > cnt(';') ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const csvCell = (v) => { v = String(v ?? ''); return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
function downloadTemplate(key) {
  const cfg = meta.entities[key].import, csv = '﻿' + [cfg.template, ...cfg.examples].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `redeye-${key}-template.csv`; a.click();
}
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^0+/, ''); return d.length === 10 ? '91' + d : d; };
const toISO = (v) => {
  v = String(v || '').trim(); if (!v) return '';
  let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(v); return Number.isNaN(t) ? null : iso(new Date(t));
};

async function importFlow(key, reload) {
  const e = meta.entities[key], cfg = e.import;
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,.tsv,.txt,text/csv';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    let grid; try { grid = parseCSV(await file.text()); } catch { return toast('Could not read that file'); }
    if (grid.length < 2) return toast('The file needs a heading row and at least one lead');
    // match each column heading to a field (by our template names or the usual alternatives)
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), alias = {};
    for (const [k, list] of Object.entries(cfg.aliases)) list.forEach((a) => (alias[norm(a)] = k));
    const map = grid[0].map((h) => alias[norm(h)] || null), unknown = grid[0].filter((h, i) => !map[i] && String(h).trim());
    if (!map.includes('name') && !map.includes('company')) return toast('No “Name” or “Company” column found. Download the template to see the expected headings.');
    const users = await api('/e/users').catch(() => []), existing = await api('/e/' + key), seenP = new Set(existing.map((x) => last10(x.phone)).filter(Boolean)), seenE = new Set(existing.map((x) => String(x.email || '').toLowerCase()).filter(Boolean)), seenI = new Set(existing.map((x) => String(x.instagram || '').toLowerCase().replace('@', '')).filter(Boolean));
    const opt = (f) => e.fields.find((x) => x.k === f).opts, pick = (v, list) => list.find((o) => o.toLowerCase() === String(v).trim().toLowerCase());
    const out = grid.slice(1).map((cells, n) => {
      const r = {}, warn = [], err = []; map.forEach((k, i) => { if (k) r[k] = String(cells[i] ?? '').trim(); });
      if (!r.name && !r.company) err.push('no name or company'); if (!r.name) r.name = r.company;
      if (r.phone) r.phone = normPhone(r.phone); if (r.phone && last10(r.phone).length < 10) warn.push('phone looks short');
      if (r.email && !/^\S+@\S+\.\S+$/.test(r.email)) { warn.push('email ignored (not valid)'); r.email = ''; }
      if (r.instagram) r.instagram = '@' + r.instagram.replace(/^.*instagram\.com\//i, '').replace(/[@/]/g, '').trim();
      if (r.value) { const v = Number(String(r.value).replace(/[^\d.]/g, '')); if (Number.isFinite(v) && v > 0) r.value = v; else { warn.push('budget ignored'); delete r.value; } }
      if (r.stage) { const s = pick(r.stage, opt('stage')); if (s) r.stage = s; else { warn.push(`stage “${r.stage}” → New`); r.stage = 'New'; } } else r.stage = 'New';
      if (r.source) { const s = pick(r.source, opt('source')); if (s) r.source = s; else { r.notes = [r.notes, `Source: ${r.source}`].filter(Boolean).join(' · '); r.source = 'Other'; } } else r.source = 'CSV import';
      for (const f of ['next_followup', 'last_contact']) if (r[f]) { const d = toISO(r[f]); if (d === null) { warn.push(`${f.replace('_', ' ')} ignored`); delete r[f]; } else r[f] = d; }
      if (r.owner_id) { const u = users.find((x) => x.email?.toLowerCase() === r.owner_id.toLowerCase() || x.name?.toLowerCase() === r.owner_id.toLowerCase()); if (u) r.owner_id = u.id; else { warn.push('owner not found'); delete r.owner_id; } }
      const dupe = (r.phone && seenP.has(last10(r.phone))) || (r.email && seenE.has(r.email.toLowerCase())) || (r.instagram && seenI.has(r.instagram.toLowerCase().replace('@', '')));
      if (!dupe) { if (r.phone) seenP.add(last10(r.phone)); if (r.email) seenE.add(r.email.toLowerCase()); if (r.instagram) seenI.add(r.instagram.toLowerCase().replace('@', '')); }
      Object.keys(r).forEach((k) => r[k] === '' && delete r[k]);
      return { n: n + 2, r, warn, err, dupe: !!dupe && !err.length };
    });
    const good = out.filter((x) => !x.err.length && !x.dupe), dupes = out.filter((x) => x.dupe), bad = out.filter((x) => x.err.length);
    const ov = document.createElement('div'); ov.className = 'ov';
    ov.innerHTML = `<div class="modal" style="max-width:820px"><header><h3>⬆ Import leads · ${esc(file.name)}</h3><button class="btn ghost sm" id="x">✕</button></header>
      <div class="body" style="grid-template-columns:1fr">
        <div style="display:flex;gap:10px;flex-wrap:wrap"><span class="tag ok">${good.length} ready to import</span><span class="tag warn">${dupes.length} already in your leads</span><span class="tag bad">${bad.length} with problems</span></div>
        ${unknown.length ? `<small style="color:var(--mute)">Columns not recognised (ignored): ${esc(unknown.join(', '))}</small>` : ''}
        ${dupes.length ? `<label style="text-transform:none;letter-spacing:0;display:flex;gap:8px;align-items:center;font-size:13px;color:var(--ink)"><input type="checkbox" id="dp" style="width:auto"> Import the ${dupes.length} duplicates anyway</label>` : ''}
        <div class="tw" style="max-height:44vh;overflow:auto"><table><thead><tr><th>Row</th><th>Name</th><th>Company</th><th>Phone</th><th>Source</th><th>Stage</th><th>Check</th></tr></thead><tbody>
          ${out.slice(0, 200).map((x) => `<tr style="cursor:default"><td>${x.n}</td><td>${esc(x.r.name || '')}</td><td>${esc(x.r.company || '')}</td><td>${esc(x.r.phone || '')}</td><td>${esc(x.r.source || '')}</td><td>${esc(x.r.stage || '')}</td><td style="white-space:normal">${x.err.length ? `<span class="tag bad">${esc(x.err.join(', '))}</span>` : x.dupe ? '<span class="tag warn">duplicate</span>' : x.warn.length ? `<span class="tag info">${esc(x.warn.join(', '))}</span>` : '<span class="tag ok">ok</span>'}</td></tr>`).join('')}</tbody></table></div>
        ${out.length > 200 ? `<small style="color:var(--mute)">Showing the first 200 of ${out.length} rows. All valid rows are imported.</small>` : ''}
        <div class="err" id="fe"></div></div>
      <footer><button class="btn ghost" id="no">Cancel</button><button class="btn" id="go">Import <span id="ct">${good.length}</span> leads</button></footer></div>`;
    document.body.append(ov);
    const close = () => ov.remove(); $('#x', ov).onclick = close; $('#no', ov).onclick = close; ov.onmousedown = (ev) => { if (ev.target === ov) close(); };
    const sel = () => [...good, ...($('#dp', ov)?.checked ? dupes : [])];
    $('#dp', ov)?.addEventListener('change', () => ($('#ct', ov).textContent = sel().length));
    $('#go', ov).onclick = async (ev) => {
      const rows = sel().map((x) => x.r); if (!rows.length) { $('#fe', ov).textContent = 'Nothing to import'; return; }
      ev.target.disabled = true; ev.target.textContent = 'Importing…';
      try { const res = await api('/import/' + key, { method: 'POST', body: { rows } }); close(); toast(`${res.count} leads imported`); reload(); }
      catch (err) { $('#fe', ov).textContent = err.message; ev.target.disabled = false; ev.target.textContent = 'Try again'; }
    };
  };
  input.click();
}

// ---------- lead outreach ----------
ACTIONS.whatsapp_lead = {
  label: '💬 Message lead',
  async run(lead, ctx) {
    if (!lead.phone && !lead.email) throw new Error('Add a phone number or email to this lead first');
    const msg = `Hello ${lead.name},\n\nThis is ${meta.user.name} from Redeye Digital Solutions. We create social media content and videos for brands like ${lead.company || 'yours'}${lead.interest ? `, and I saw you were interested in ${lead.interest}` : ''}.\n\nCould we have a quick chat this week about how we can help you grow on Instagram? Happy to share a few examples of our work.\n\nThank you!`;
    shareModal({ title: `Message ${lead.name}`, phone: lead.phone, email: lead.email, subject: 'Redeye Digital Solutions: content for ' + (lead.company || lead.name), link: '', message: msg, markLabel: 'Log as contacted (follow up in 3 days)',
      onSent: async () => { await api(`/e/leads/${lead.id}`, { method: 'PUT', body: { ...lead, last_contact: today(), next_followup: addDays(3), stage: lead.stage === 'New' ? 'Contacted' : lead.stage } }); if (ctx?.after) ctx.after(); } });
  },
};
ACTIONS.log_followup = {
  label: '📞 Log follow-up',
  async run(lead, ctx) {
    formModal(`Follow-up · ${lead.name}`, `<div class="full"><label>What happened?</label><select name="out"><option value="Contacted">Called / messaged: no reply yet</option><option value="Replied">They replied</option><option value="Meeting">Meeting scheduled</option><option value="Proposal">Proposal sent</option><option value="Won">Won 🎉</option><option value="Lost">Not interested / lost</option></select></div>
      <div><label>Follow up again in</label><select name="days"><option value="2">2 days</option><option value="3" selected>3 days</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option><option value="">No follow-up</option></select></div>
      <div class="full"><label>Note</label><textarea name="note" placeholder="e.g. wants reel samples, budget ~₹30k"></textarea></div>`, 'Save', async (f, close) => {
      const closed = ['Won', 'Lost'].includes(f.out), notes = [lead.notes, f.note && `${NICE_DATE(today())}: ${f.note}`].filter(Boolean).join('\n');
      await api(`/e/leads/${lead.id}`, { method: 'PUT', body: { ...lead, stage: f.out, last_contact: today(), next_followup: closed || !f.days ? '' : addDays(+f.days), notes } });
      close(); if (ctx.close) ctx.close(); toast('Follow-up logged'); ctx.after();
    });
  },
};

// ---------- CRM: scoring, bulk work, timeline, follow-up queue, analytics ----------
const STAGES = ['New', 'Contacted', 'Replied', 'Meeting', 'Proposal', 'Won'];           // the happy path (Lost can happen anywhere)
const PROB = { New: 0.05, Contacted: 0.1, Replied: 0.25, Meeting: 0.4, Proposal: 0.6 };   // chance to win, for the forecast
const SRC_Q = { Referral: 15, 'Walk-in': 12, 'Ad campaign': 8, Instagram: 8, WhatsApp: 8, Website: 8, 'Google Maps': 6, Justdial: 4, 'Cold outreach': 3, Other: 2 };
const LOST_REASONS = ['Budget too high', 'No response', 'Went with a competitor', 'Not ready yet', 'Wrong fit', 'Other'];
const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(String(d).length > 10 ? d : d + 'T00:00:00').getTime()) / 864e5) : null);
function leadScore(l) {
  if (!l || ['Won', 'Lost'].includes(l.stage)) return null;
  let s = 0;
  if (l.phone) s += 10; if (l.email) s += 5; if (l.instagram) s += 5; if (l.city) s += 2;
  const v = +l.value || 0; s += v >= 50000 ? 15 : v >= 20000 ? 10 : v >= 10000 ? 5 : 0;
  s += { New: 0, Contacted: 10, Replied: 25, Meeting: 40, Proposal: 50 }[l.stage] || 0;
  s += SRC_Q[l.source] ?? 2;
  const lc = daysSince(l.last_contact); if (lc !== null) s += lc <= 7 ? 10 : lc > 30 ? -10 : 0;
  if (l.next_followup && l.next_followup < today()) s -= 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}
const scoreBadge = (l) => { const s = leadScore(l); if (s === null) return '<span style="color:var(--mute)">—</span>'; const c = s >= 65 ? 'hot' : s >= 35 ? 'warm' : 'cold'; return `<span class="sc ${c}" title="${c === 'hot' ? 'Hot' : c === 'warm' ? 'Warm' : 'Cold'} lead">${s}</span>`; };

function askLostReason() {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const ov = formModal('Why was this lead lost?', `<div class="full"><label>Reason</label><select name="r">${LOST_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>`, 'Save', async (f, close) => { fin(f.r); close(); });
    const rm = () => fin(null); ov.querySelector('#x').addEventListener('click', rm); ov.addEventListener('mousedown', (e) => { if (e.target === ov) rm(); });
  });
}
const logActivity = (lead_id, kind, body) => api('/activities', { method: 'POST', body: { lead_id, kind, body } }).catch(() => {});

// ----- bulk bar (selection toolbar above the table) -----
async function bulkApply(rows, patch, reload, label) {
  let n = 0;
  for (const r of rows) { try { await api(`/e/leads/${r.id}`, { method: 'PUT', body: { ...r, ...patch } }); n++; if (n % 5 === 0) toast(`${label}… ${n}/${rows.length}`); } catch (err) { toast(err.message); break; } }
  toast(`${label}: ${n} lead${n === 1 ? '' : 's'} updated`); reload();
}
function bulkMessage(rows, reload) {
  const withPhone = rows.filter((r) => last10(r.phone).length >= 10);
  const def = `Hello {name},\n\nThis is ${meta.user.name} from Redeye Digital Solutions. We create social media content and videos for brands like {company}. Could we have a quick chat this week about how we can help you grow on Instagram?\n\nThank you!`;
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal" style="max-width:700px"><header><h3>💬 Message ${withPhone.length} leads</h3><button class="btn ghost sm" id="x">✕</button></header><div class="body" style="grid-template-columns:1fr">
    <div><label>Message (use {name} and {company})</label><textarea id="tp" style="min-height:140px">${esc(def)}</textarea></div>
    <small style="color:var(--mute)">WhatsApp opens one chat at a time with each person's name filled in; you press send. Each lead you open is logged as contacted with a follow-up in 3 days.${rows.length > withPhone.length ? ` ${rows.length - withPhone.length} selected lead(s) have no phone number and are skipped.` : ''}</small>
    <div class="pick" style="max-height:34vh">${withPhone.map((r) => `<div class="row" data-id="${r.id}"><span><b>${esc(r.name)}</b><br><small>${esc(r.company || '')} · ${esc(r.phone)}</small></span><button class="btn sm" data-wa="${r.id}">Open WhatsApp</button></div>`).join('') || '<small>None of the selected leads has a phone number.</small>'}</div>
    <div class="err" id="fe"></div></div><footer><span id="cn" style="flex:1;align-self:center;color:var(--mute)">0 sent</span><button class="btn ghost" id="dn">Done</button></footer></div>`;
  document.body.append(ov); let sent = 0;
  const close = () => { ov.remove(); reload(); }; $('#x', ov).onclick = close; $('#dn', ov).onclick = close;
  ov.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = async () => {
    const lead = withPhone.find((r) => String(r.id) === b.dataset.wa), text = $('#tp', ov).value.replace(/\{name\}/g, String(lead.name).split(' ')[0]).replace(/\{company\}/g, lead.company || 'your business');
    window.open(`https://wa.me/${waNumber(lead.phone)}?text=${encodeURIComponent(text)}`, '_blank');
    b.disabled = true; b.textContent = '✓ Opened'; $('#cn', ov).textContent = `${++sent} sent`;
    try { await api(`/e/leads/${lead.id}`, { method: 'PUT', body: { ...lead, last_contact: today(), next_followup: addDays(3), stage: lead.stage === 'New' ? 'Contacted' : lead.stage } }); await logActivity(lead.id, 'WhatsApp', 'Bulk intro message'); } catch {}
  }));
}
function bulkBar(rows, getSel, reload, box) {
  const sel = getSel(); if (!sel.length) { box.innerHTML = ''; return; }
  const admin = meta.user.role === 'admin';
  box.innerHTML = `<div class="panel bulk"><b>${sel.length} selected</b>
    <select id="bs"><option value="">Set stage…</option>${meta.entities.leads.fields.find((f) => f.k === 'stage').opts.map((o) => `<option>${o}</option>`).join('')}</select>
    <select id="bo"><option value="">Assign owner…</option>${(lookups.users || []).map((u) => `<option value="${u.id}">${esc(u.label)}</option>`).join('')}</select>
    <input id="bd" type="date" title="Next follow-up" style="width:auto"><button class="btn ghost sm" id="bdb">Set follow-up</button>
    <button class="btn ghost sm" id="bt">+ Tag</button><button class="btn sm" id="bm">💬 Message</button>${admin ? '<button class="btn danger sm" id="bx">Delete</button>' : ''}<button class="btn ghost sm" id="bc">Clear</button></div>`;
  const apply = (p, l) => bulkApply(sel, p, reload, l);
  $('#bs', box).onchange = async (e) => { const v = e.target.value; if (!v) return; let p = { stage: v }; if (v === 'Lost') { const r = await askLostReason(); if (!r) return; p.lost_reason = r; } if (['Won', 'Lost'].includes(v)) p.next_followup = ''; apply(p, 'Stage'); };
  $('#bo', box).onchange = (e) => e.target.value && apply({ owner_id: e.target.value }, 'Owner');
  $('#bdb', box).onclick = () => { const d = $('#bd', box).value; if (!d) return toast('Pick a date first'); apply({ next_followup: d }, 'Follow-up'); };
  $('#bt', box).onclick = async () => {
    const t = (prompt('Tag to add to the selected leads:') || '').trim(); if (!t) return;
    let n = 0;
    for (const r of sel) { const tags = [...new Set(String(r.tags || '').split(',').map((x) => x.trim()).filter(Boolean).concat(t))].join(', '); try { await api(`/e/leads/${r.id}`, { method: 'PUT', body: { ...r, tags } }); n++; } catch (err) { toast(err.message); break; } }
    toast(`Tagged ${n} leads`); reload();
  };
  $('#bm', box).onclick = () => bulkMessage(sel, reload);
  if ($('#bx', box)) $('#bx', box).onclick = async () => { if (!confirm(`Delete ${sel.length} leads permanently?`)) return; let n = 0; for (const r of sel) { try { await api(`/e/leads/${r.id}`, { method: 'DELETE' }); n++; } catch (err) { toast(err.message); break; } } toast(`${n} deleted`); reload(); };
  $('#bc', box).onclick = () => { document.querySelectorAll('.sel,#selall').forEach((c) => (c.checked = false)); box.innerHTML = ''; };
}

// ----- timeline inside a lead -----
const ACT_ICON = { Created: '✨', Stage: '🔀', Call: '📞', WhatsApp: '💬', Email: '✉️', Meeting: '🤝', Note: '📝' };
async function drawTimeline(box, lead) {
  let list = []; try { list = await api('/activities', { body: { lead_id: lead.id } }); } catch (err) { box.innerHTML = `<small style="color:var(--mute)">${esc(err.message)}</small>`; return; }
  box.innerHTML = `<div class="tlq">${['Call', 'WhatsApp', 'Email', 'Meeting', 'Note'].map((k) => `<button type="button" class="btn ghost sm" data-k="${k}">${ACT_ICON[k]} ${k}</button>`).join('')}</div>
    <div class="tl">${list.map((a) => `<div class="tli"><span class="ti">${ACT_ICON[a.kind] || '•'}</span><div><b>${esc(a.kind)}</b> ${a.body ? '· ' + esc(a.body) : ''}<br><small style="color:var(--mute)">${esc(lbl('users', a.created_by) || '')} · ${esc(agoText(a.created_at))}</small></div></div>`).join('') || '<small style="color:var(--mute)">No activity yet</small>'}</div>`;
  box.querySelectorAll('[data-k]').forEach((b) => (b.onclick = async () => {
    const note = prompt(`${b.dataset.k}: what happened? (short note)`); if (note === null) return;
    await logActivity(lead.id, b.dataset.k, note.trim() || null);
    if (b.dataset.k !== 'Note') { try { await api(`/e/leads/${lead.id}`, { method: 'PUT', body: { ...lead, last_contact: today(), stage: lead.stage === 'New' ? 'Contacted' : lead.stage } }); lead.last_contact = today(); } catch {} }
    drawTimeline(box, lead);
  }));
}

// ----- log follow-up (replaces the simple version) -----
ACTIONS.log_followup = {
  label: '📞 Log follow-up',
  async run(lead, ctx) {
    formModal(`Follow-up · ${lead.name}`, `<div><label>How?</label><select name="how"><option>Call</option><option>WhatsApp</option><option>Email</option><option>Meeting</option></select></div>
      <div><label>Outcome</label><select name="out"><option value="Contacted">No reply yet</option><option value="Replied">They replied</option><option value="Meeting">Meeting scheduled</option><option value="Proposal">Proposal sent</option><option value="Won">Won 🎉</option><option value="Lost">Not interested / lost</option></select></div>
      <div><label>Follow up again in</label><select name="days"><option value="2">2 days</option><option value="3" selected>3 days</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option><option value="">No follow-up</option></select></div>
      <div><label>If lost: reason</label><select name="lr"><option value=""></option>${LOST_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
      <div class="full"><label>Note</label><textarea name="note" placeholder="e.g. wants reel samples, budget ~₹30k"></textarea></div>`, 'Save', async (f, close) => {
      if (f.out === 'Lost' && !f.lr) throw new Error('Choose why this lead was lost');
      const closed = ['Won', 'Lost'].includes(f.out), notes = [lead.notes, f.note && `${NICE_DATE(today())}: ${f.note}`].filter(Boolean).join('\n');
      await api(`/e/leads/${lead.id}`, { method: 'PUT', body: { ...lead, stage: f.out, lost_reason: f.out === 'Lost' ? f.lr : lead.lost_reason, last_contact: today(), next_followup: closed || !f.days ? '' : addDays(+f.days), notes } });
      await logActivity(lead.id, f.how, f.note || ({ Contacted: 'No reply yet', Replied: 'They replied', Meeting: 'Meeting scheduled', Proposal: 'Proposal sent', Won: 'Won', Lost: 'Lost' })[f.out]);
      close(); if (ctx.close) ctx.close(); toast('Follow-up logged'); ctx.after();
    });
  },
};
const _wl = ACTIONS.whatsapp_lead.run;
ACTIONS.whatsapp_lead.run = async (lead, ctx) => _wl(lead, { ...ctx, after: () => { logActivity(lead.id, 'WhatsApp', 'Intro message'); ctx?.after?.(); } });

// ----- follow-up queue page -----
async function followupsView(view) {
  const leads = (await api('/e/leads')).filter((l) => !['Won', 'Lost'].includes(l.stage)), t0 = today(), wk = addDays(7);
  await lookup('users');
  const sc = (l) => leadScore(l) ?? 0, byScore = (a, b) => sc(b) - sc(a);
  const lists = {
    overdue: leads.filter((l) => l.next_followup && l.next_followup < t0).sort((a, b) => (a.next_followup < b.next_followup ? -1 : 1)),
    today: leads.filter((l) => l.next_followup === t0).sort(byScore),
    week: leads.filter((l) => l.next_followup > t0 && l.next_followup <= wk).sort((a, b) => (a.next_followup < b.next_followup ? -1 : 1)),
    nodate: leads.filter((l) => !l.next_followup).sort(byScore),
    fresh: leads.filter((l) => l.stage === 'New' && !l.last_contact).sort(byScore),
  };
  let tab = lists.overdue.length ? 'overdue' : lists.today.length ? 'today' : 'fresh';
  const labels = { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', fresh: 'Never contacted', nodate: 'No date set' };
  const reload = () => route();
  const card = (l) => `<div class="need ${l.next_followup && l.next_followup < t0 ? 'bad' : 'info'}"><div class="nt"><span class="ni">${scoreBadge(l)}</span><span><b>${esc(l.name)}</b> <small style="color:var(--mute)">${esc(l.company || '')}</small><br>
      <small style="color:var(--mute)">${esc([l.stage, l.source, l.city, l.value ? money(l.value) : '', l.next_followup ? 'due ' + NICE_DATE(l.next_followup) : '', l.last_contact ? 'last contact ' + daysSince(l.last_contact) + 'd ago' : 'never contacted', lbl('users', l.owner_id) && 'owner ' + lbl('users', l.owner_id)].filter(Boolean).join(' · '))}</small>${l.notes ? `<br><small>${esc(String(l.notes).split('\n').pop().slice(0, 110))}</small>` : ''}</span></div>
    <div class="na">${l.phone ? `<a class="btn sm" href="tel:+${waNumber(l.phone)}">📞 Call</a><button class="btn ghost sm" data-w="${l.id}">💬 WhatsApp</button>` : ''}<button class="btn ghost sm" data-l="${l.id}">✅ Log</button><button class="btn ghost sm" data-s="${l.id}:1">+1d</button><button class="btn ghost sm" data-s="${l.id}:3">+3d</button><button class="btn ghost sm" data-o="${l.id}">Open</button></div></div>`;
  const draw = () => {
    view.innerHTML = `<div class="seg" style="margin-bottom:14px">${Object.keys(labels).map((k) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${labels[k]} (${lists[k].length})</button>`).join('')}</div>
      ${lists[tab].map(card).join('') || '<div class="empty">🎉 Nothing here. Everything is up to date.</div>'}`;
    view.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const find = (id) => leads.find((l) => String(l.id) === String(id));
    view.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => ACTIONS.whatsapp_lead.run(find(b.dataset.w), { close() {}, after: reload }).catch((e) => toast(e.message))));
    view.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => ACTIONS.log_followup.run(find(b.dataset.l), { close() {}, after: reload })));
    view.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => form('leads', find(b.dataset.o), reload)));
    view.querySelectorAll('[data-s]').forEach((b) => (b.onclick = async () => { const [id, n] = b.dataset.s.split(':'); const l = find(id); await api(`/e/leads/${id}`, { method: 'PUT', body: { ...l, next_followup: addDays(+n) } }); toast(`Moved to ${NICE_DATE(addDays(+n))}`); reload(); }));
  };
  draw();
}

// ----- analytics page -----
async function crmView(view) {
  const [leadsAll, acts] = await Promise.all([api('/e/leads'), api('/activities', { body: {} }).catch(() => [])]);
  await Promise.all([lookup('users')]);
  let range = 90;
  const draw = () => {
    const cutoff = range ? new Date(Date.now() - range * 864e5).toISOString() : '', t0 = today();
    const L = leadsAll.filter((l) => !cutoff || String(l.created_at || '') >= cutoff), N = L.length || 1;
    const actBy = {}; acts.forEach((a) => (actBy[a.lead_id] ||= []).push(a));
    const reached = (l) => { let r = Math.max(STAGES.indexOf(l.stage), 0); for (const a of actBy[l.id] || []) if (a.to_stage) r = Math.max(r, STAGES.indexOf(a.to_stage)); if (l.last_contact || (actBy[l.id] || []).some((a) => ['Call', 'WhatsApp', 'Email', 'Meeting'].includes(a.kind))) r = Math.max(r, 1); return r; };
    const won = L.filter((l) => l.stage === 'Won'), lost = L.filter((l) => l.stage === 'Lost'), open = L.filter((l) => !['Won', 'Lost'].includes(l.stage));
    const sum = (a, k = 'value') => a.reduce((s, x) => s + (+x[k] || 0), 0), pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const fun = STAGES.map((s, i) => ({ s, n: L.filter((l) => reached(l) >= i).length }));
    const pipe = sum(open), weighted = open.reduce((s, l) => s + (+l.value || 0) * (PROB[l.stage] || 0), 0);
    const closeDays = won.map((l) => { const a = (actBy[l.id] || []).find((x) => x.to_stage === 'Won'); return a ? (new Date(a.created_at) - new Date(l.created_at)) / 864e5 : null; }).filter((x) => x !== null);
    const avgClose = closeDays.length ? Math.round(closeDays.reduce((a, b) => a + b, 0) / closeDays.length) : null;
    const stale = open.filter((l) => (l.last_contact ? daysSince(l.last_contact) >= 7 : daysSince(l.created_at) >= 2)).sort((a, b) => (leadScore(b) || 0) - (leadScore(a) || 0));
    const overdue = open.filter((l) => l.next_followup && l.next_followup < t0).length, unowned = open.filter((l) => !l.owner_id).length;
    const grp = (keyFn) => { const m = {}; L.forEach((l) => { const k = keyFn(l); if (k) (m[k] ||= []).push(l); }); return Object.entries(m).map(([k, a]) => ({ k, n: a.length, replied: a.filter((l) => reached(l) >= 2).length, won: a.filter((l) => l.stage === 'Won').length, val: sum(a.filter((l) => l.stage === 'Won')), open: sum(a.filter((l) => !['Won', 'Lost'].includes(l.stage))) })).sort((a, b) => b.val - a.val || b.n - a.n); };
    const bySrc = grp((l) => l.source), byCamp = grp((l) => l.campaign), byCity = grp((l) => l.city).slice(0, 8), byOwner = grp((l) => lbl('users', l.owner_id) || 'Unassigned');
    const lostBy = {}; lost.forEach((l) => (lostBy[l.lost_reason || 'No reason recorded'] = (lostBy[l.lost_reason || 'No reason recorded'] || 0) + 1));
    const lostRows = Object.entries(lostBy).sort((a, b) => b[1] - a[1]);
    // weekly trend (last 12 weeks, all leads)
    const wkStart = (d) => iso(mondayOf(new Date(d))), weeks = [...Array(12)].map((_, i) => iso(new Date(mondayOf(new Date()).getTime() - (11 - i) * 7 * 864e5)));
    const created = {}, wonW = {}; leadsAll.forEach((l) => { if (l.created_at) { const k = wkStart(l.created_at); created[k] = (created[k] || 0) + 1; } });
    acts.filter((a) => a.to_stage === 'Won').forEach((a) => { const k = wkStart(a.created_at); wonW[k] = (wonW[k] || 0) + 1; });
    const tmax = Math.max(1, ...weeks.map((w) => created[w] || 0));
    const money0 = (n) => money(Math.round(n || 0)), kpi = (t, v, s = '') => `<div class="panel kpi"><small>${t}</small><div class="v">${v}</div><div class="s">${s}</div></div>`;
    // insights in plain words
    const tips = [], srcOk = bySrc.filter((x) => x.n >= 3).sort((a, b) => pct(b.won, b.n) - pct(a.won, a.n) || b.val - a.val);
    if (srcOk[0] && srcOk[0].won) tips.push(`Best source: <b>${esc(srcOk[0].k)}</b> turns ${pct(srcOk[0].won, srcOk[0].n)}% of leads into clients (${srcOk[0].won} of ${srcOk[0].n}).`);
    if (byCamp[0] && byCamp[0].val) tips.push(`Campaign bringing the most revenue: <b>${esc(byCamp[0].k)}</b> (${money0(byCamp[0].val)} won).`);
    let worst = null; for (let i = 1; i < fun.length; i++) { const d = fun[i - 1].n ? 1 - fun[i].n / fun[i - 1].n : 0; if (fun[i - 1].n >= 5 && (!worst || d > worst.d)) worst = { d, from: fun[i - 1].s, to: fun[i].s }; }
    if (worst) tips.push(`Biggest drop-off: leads that reach <b>${esc(worst.from)}</b> but not <b>${esc(worst.to)}</b> (${Math.round(worst.d * 100)}% lost). Work on that step.`);
    if (lostRows[0]) tips.push(`Most common reason for losing: <b>${esc(lostRows[0][0])}</b> (${lostRows[0][1]} leads).`);
    if (stale.length) tips.push(`<b>${stale.length}</b> open leads haven't been touched in 7+ days${stale.length > 4 ? '. Open the Follow-up queue to clear them.' : '.'}`);
    if (unowned) tips.push(`<b>${unowned}</b> open leads have no owner, so nobody gets their reminders. Assign them in bulk from the Leads list.`);
    const tbl = (rows, head) => `<div class="tw"><table><thead><tr><th>${head}</th><th>Leads</th><th>Replied</th><th>Won</th><th>Win rate</th><th>Won value</th><th>Open pipeline</th></tr></thead><tbody>${rows.map((r) => `<tr style="cursor:default"><td><b>${esc(r.k)}</b></td><td>${r.n}</td><td>${pct(r.replied, r.n)}%</td><td>${r.won}</td><td><span class="tag ${pct(r.won, r.n) >= 20 ? 'ok' : pct(r.won, r.n) >= 8 ? 'warn' : ''}">${pct(r.won, r.n)}%</span></td><td>${r.val ? money0(r.val) : '—'}</td><td>${r.open ? money0(r.open) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" style="color:var(--mute)">No data</td></tr>'}</tbody></table></div>`;
    view.innerHTML = `<div class="bar"><div class="seg" id="rg">${[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year'], [0, 'All time']].map(([d, l]) => `<button data-d="${d}" class="${d === range ? 'on' : ''}">${l}</button>`).join('')}</div><span class="sp"></span><button class="btn ghost" id="gofq">📞 Follow-up queue</button><button class="btn ghost" id="gol">🎯 Leads</button></div>
      <div class="grid">${kpi('Leads', L.length, `${open.length} still open`)}${kpi('Contacted', pct(fun[1].n, N) + '%', `${fun[1].n} of ${L.length}`)}${kpi('Replied', pct(fun[2].n, N) + '%', `${fun[2].n} replied or further`)}${kpi('Won', won.length, `${pct(won.length, N)}% of leads · ${pct(won.length, won.length + lost.length)}% of closed`)}${kpi('Won value', money0(sum(won)), won.length ? `avg ${money0(sum(won) / won.length)}` : '')}${kpi('Open pipeline', money0(pipe), `forecast ${money0(weighted)} (weighted)`)}${kpi('Avg days to win', avgClose === null ? '—' : avgClose, closeDays.length ? `from ${closeDays.length} wins` : 'no wins yet')}${kpi('Needs attention', overdue + stale.length, `${overdue} overdue follow-ups · ${stale.length} untouched`)}</div>
      ${tips.length ? `<div class="panel" style="margin-bottom:14px;border-color:var(--brand)"><h3>💡 What the numbers say</h3>${tips.map((t) => `<p style="margin:6px 0">${t}</p>`).join('')}</div>` : ''}
      <div class="stack" style="margin-top:0"><div class="panel"><h3>Funnel</h3>${fun.map((f, i) => `<div class="row" style="gap:12px"><span style="width:92px">${f.s}</span><div style="flex:1"><div class="bar2" style="width:${Math.max(3, pct(f.n, fun[0].n || 1))}%"></div></div><b style="width:110px;text-align:right">${f.n} <small style="color:var(--mute)">${i ? pct(f.n, fun[i - 1].n) + '% of prev' : ''}</small></b></div>`).join('')}<p style="color:var(--mute);font-size:12px;margin:8px 0 0">Counts every lead that ever reached the stage.</p></div>
        <div class="panel"><h3>New leads per week (12 weeks)</h3><div class="trend">${weeks.map((w) => `<div class="tc"><div class="tb" style="height:${Math.max(4, ((created[w] || 0) / tmax) * 100)}%" title="${created[w] || 0} new, ${wonW[w] || 0} won">${wonW[w] ? `<i style="height:${Math.min(100, (wonW[w] / (created[w] || 1)) * 100)}%"></i>` : ''}</div><small>${w.slice(5)}</small></div>`).join('')}</div><div class="legend"><span><i class="dot" style="background:var(--brand)"></i>New leads</span><span><i class="dot" style="background:#15803d"></i>Won (share)</span></div></div></div>
      <div class="panel" style="margin-top:14px"><h3>By source</h3>${tbl(bySrc, 'Source')}</div>
      <div class="panel" style="margin-top:14px"><h3>By campaign</h3>${tbl(byCamp, 'Campaign')}</div>
      <div class="stack"><div class="panel"><h3>By owner</h3>${tbl(byOwner, 'Owner')}</div><div class="panel"><h3>By city</h3>${tbl(byCity, 'City')}</div></div>
      <div class="stack"><div class="panel"><h3>Why leads are lost</h3>${lostRows.map(([r, n]) => `<div class="row" style="gap:12px"><span style="width:170px">${esc(r)}</span><div style="flex:1"><div class="bar2" style="width:${Math.max(4, (n / lostRows[0][1]) * 100)}%"></div></div><b>${n}</b></div>`).join('') || '<div style="color:var(--mute)">No lost leads yet</div>'}</div>
        <div class="panel"><h3>⚠️ Going cold (${stale.length})</h3>${stale.slice(0, 8).map((l) => `<div class="row"><span><a href="#" data-o="${l.id}">${esc(l.name)}</a> ${scoreBadge(l)}<br><small style="color:var(--mute)">${esc(l.stage)} · ${l.last_contact ? daysSince(l.last_contact) + ' days since contact' : 'never contacted'}${l.value ? ' · ' + money0(l.value) : ''}</small></span></div>`).join('') || '<div style="color:var(--mute)">Nothing is going cold 🎉</div>'}</div></div>`;
    view.querySelectorAll('#rg button').forEach((b) => (b.onclick = () => { range = +b.dataset.d; draw(); }));
    view.querySelectorAll('[data-o]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); form('leads', leadsAll.find((l) => String(l.id) === a.dataset.o), () => route()); }));
    $('#gofq', view).onclick = () => (location.hash = '#/followups'); $('#gol', view).onclick = () => (location.hash = '#/leads');
  };
  draw();
}

// ---------- task reminders ----------
ACTIONS.remind_task = {
  label: '🔔 Remind assignee',
  async run(t) {
    if (!t.assignee_id) throw new Error('Assign the task to someone first');
    const note = prompt(`Remind ${lbl('users', t.assignee_id) || 'the assignee'} about “${t.title}”.\nAdd a short note (optional):`, '');
    if (note === null) return;
    await api('/tasks/remind', { method: 'POST', body: { id: t.id, note } });
    toast('Reminder sent');
  },
};
ACTIONS.snooze_task = {
  label: '😴 Snooze my reminder',
  async run(t, ctx) {
    if (t.assignee_id !== meta.user.id) throw new Error('Only the person assigned can snooze this reminder');
    const tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(9, 0, 0, 0);
    formModal(`Snooze · ${t.title}`, `<div class="full"><label>Remind me again in</label><select name="m"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="180">3 hours</option><option value="${Math.max(10, Math.round((tm - Date.now()) / 60000))}">Tomorrow morning (9 AM)</option></select></div>`, 'Snooze', async (f, close) => {
      await api('/tasks/snooze', { method: 'POST', body: { id: t.id, mins: +f.m } }); close(); if (ctx.close) ctx.close(); toast('Snoozed'); ctx.after();
    });
  },
};

// ---------- payment requests ----------
ACTIONS.payment_request = {
  label: '📨 Payment request',
  async run(inv, ctx) {
    const bal = balanceOf(inv);
    if (bal <= 0) return toast('Nothing is due on this invoice');
    if (!confirm(`Create a payment request for ${money2(bal)} (balance of ${inv.number}) and send it to the client?`)) return;
    const r = await api('/e/payment_requests', { method: 'POST', body: { client_id: inv.client_id, invoice_id: inv.id, amount: bal, purpose: `Invoice ${inv.number}`, due_date: inv.due_date && inv.due_date >= today() ? inv.due_date : addDays(3), status: 'Open' } });
    if (ctx.close) ctx.close();
    await ACTIONS.send_payment_request.run(r, ctx);
  },
};
ACTIONS.send_payment_request = {
  label: '💬 Send payment request',
  async run(req, ctx) {
    if (!req.share_token) throw new Error('Sharing is not set up yet');
    if (['Paid', 'Cancelled'].includes(req.status)) return toast('This request is already ' + req.status.toLowerCase());
    const c = await contactOf(req.client_id), link = `${appBase()}#/pay/${req.share_token}`;
    shareModal({ title: `Payment request · ${money2(req.amount)}`, phone: c.phone, email: c.email, subject: `Payment request — ${req.purpose}`, link,
      message: `Hello ${c.name},\n\nRequesting payment of ${money2(req.amount)} for ${req.purpose}${req.due_date ? `, by ${NICE_DATE(req.due_date)}` : ''}.\n\nPay by UPI or bank transfer here (private link):\n${link}\n\nAfter paying, please enter the reference number on that page so we can confirm. Thank you!\nRedeye Digital Solutions` });
  },
};
ACTIONS.confirm_request_paid = {
  label: '✅ Confirm payment received',
  async run(req, ctx) {
    if (req.status === 'Paid') return toast('Already confirmed');
    if (!confirm(`Confirm you received ${money2(req.amount)}${req.claimed_ref ? ` (ref ${req.claimed_ref})` : ''}? ${req.invoice_id ? 'This records the payment against the invoice.' : ''}`)) return;
    if (req.invoice_id) await api('/e/payments', { method: 'POST', body: { invoice_id: req.invoice_id, amount: +req.amount, paid_on: today(), method: 'UPI', reference: req.claimed_ref || `Request #${req.id}` } });
    await api(`/e/payment_requests/${req.id}`, { method: 'PUT', body: { ...req, status: 'Paid' } });
    if (ctx.close) ctx.close(); toast('Payment confirmed'); ctx.after();
  },
};

async function renderPayPage(token) {
  pubShell('<p>Loading…</p>');
  let r = null; try { r = await api('/public/payreq', { method: 'POST', body: { token } }); } catch {}
  if (!r) return pubError();
  const q = r.request, co = r.company || {}, bank = co.bank || {}, who0 = (() => { try { return localStorage.getItem('approver') || ''; } catch { return ''; } })();
  const upi = co.upi_id ? `upi://pay?pa=${encodeURIComponent(co.upi_id)}&pn=${encodeURIComponent(co.name || '')}&am=${encodeURIComponent(q.amount)}&cu=INR&tn=${encodeURIComponent((q.purpose || 'Payment').slice(0, 60))}` : '';
  const done = q.status === 'Paid', claimed = q.status === 'Paid claimed', dead = q.status === 'Cancelled';
  pubShell(`<h1 class="ph1">Payment request</h1><p class="pm">${esc(r.client?.name || '')} · from ${esc(co.name)}</p>
    <div class="panel" style="text-align:center"><div style="color:var(--mute)">${esc(q.purpose || '')}${r.invoice?.number && !String(q.purpose || '').includes(r.invoice.number) ? ` · ${esc(r.invoice.number)}` : ''}</div><div style="font-size:42px;font-weight:700;letter-spacing:-.02em;margin:6px 0">${money2(q.amount)}</div>${q.due_date ? `<div class="pm">Please pay by ${esc(NICE_DATE(q.due_date))}</div>` : ''}
      ${done ? '<div class="tag ok">✅ Paid, thank you!</div>' : dead ? '<div class="tag bad">This request was cancelled</div>' : claimed ? `<div class="tag warn">Reference ${esc(q.claimed_ref)} received, we will confirm shortly</div>` : ''}</div>
    ${done || dead ? '' : `${upi ? `<div class="panel" style="text-align:center"><h3>Pay with UPI</h3><p><a class="btn" href="${esc(upi)}">Pay ${money2(q.amount)} with UPI</a></p><div id="qr" style="display:flex;justify-content:center;margin:10px 0"></div>
      <p class="pm">UPI ID: <b id="upid">${esc(co.upi_id)}</b> <a href="#" id="cpu">copy</a><br>On a phone, tap the button. On a computer, scan the QR code with any UPI app.</p></div>` : ''}
    ${bank.account ? `<div class="panel"><h3>Or bank transfer</h3><div class="pbox">Account holder: <b>${esc(bank.holder)}</b><br>Bank: ${esc(bank.bank)}${bank.branch ? ', ' + esc(bank.branch) : ''}<br>Account number: <b>${esc(bank.account)}</b><br>IFSC: <b>${esc(bank.ifsc)}</b></div></div>` : ''}
    <div class="panel"><h3>Already paid?</h3><p class="pm">Enter the UPI transaction ID / UTR so we can confirm quickly.</p><label>Your name</label><input id="cw" value="${esc(who0)}"><label style="margin-top:10px">UPI / bank reference</label><input id="cr" placeholder="e.g. 4210XXXXXXXX"><div class="err" id="ce"></div><button class="btn" id="cb">I have paid</button></div>`}
    <p class="pubft">Questions? ${esc(co.email || '')} ${esc(co.phone || '')}</p>`);
  if ($('#cpu')) $('#cpu').onclick = async (e) => { e.preventDefault(); try { await navigator.clipboard.writeText(co.upi_id); toast('UPI ID copied'); } catch { toast(co.upi_id); } };
  if (upi && $('#qr')) {
    const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    sc.onload = () => { try { new window.QRCode($('#qr'), { text: upi, width: 190, height: 190, correctLevel: window.QRCode.CorrectLevel.M }); } catch {} };
    document.head.append(sc);
  }
  if ($('#cb')) $('#cb').onclick = async () => {
    try { localStorage.setItem('approver', $('#cw').value.trim()); } catch {}
    try { await api('/public/claim', { method: 'POST', body: { token, ref: $('#cr').value, who: $('#cw').value } }); renderPayPage(token); } catch (err) { $('#ce').textContent = err.message; }
  };
}

// ---------- Control Tower: what needs you, client health, what's working ----------
async function controlTowerView(view) {
  const isMgr = meta.user.role !== 'staff', me = meta.user.id, t0 = today();
  const safe = (p) => p.catch(() => []);
  const [items, shoots, tasks, invs, , reqs, pkgs, contracts, gear] = await Promise.all([
    safe(api('/e/content_items')), safe(api('/e/shoots')), safe(api('/e/tasks')),
    isMgr ? safe(api('/e/invoices')) : [], isMgr ? safe(api('/e/payments')) : [], isMgr ? safe(api('/e/payment_requests')) : [], isMgr ? safe(api('/e/packages')) : [], isMgr ? safe(api('/e/contracts')) : [], safe(api('/e/equipment_log')),
    lookup('clients'), lookup('users'), lookup('assets')]);
  const dd = (d) => Math.round((new Date(String(d).slice(0, 10) + 'T00:00:00') - new Date(t0 + 'T00:00:00')) / 864e5);
  const when = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : `in ${n} days`);
  const mineI = (i) => isMgr || [i.owner_id, i.writer_id, i.editor_id, i.designer_id].includes(me);
  const reload = () => route();
  const open = (key, row) => () => form(key, row, reload);
  const run = (name, row, key) => () => ACTIONS[name].run(row, { close() {}, after: reload, key }).catch((e) => toast(e.message));
  const needs = [];
  const add = (sev, icon, title, detail, actions = []) => needs.push({ sev, icon, title, detail, actions });
  const PRE = ['Idea', 'Scripting', 'Ready to shoot', 'Shoot scheduled'];

  if (isMgr) {
    for (const r of reqs.filter((x) => x.status === 'Paid claimed')) add(3, '💸', `Confirm ${money(r.amount)} from ${lbl('clients', r.client_id)}`, `They say they paid · ref ${r.claimed_ref}. Check your bank/UPI, then confirm.`, [{ l: '✅ Confirm', f: run('confirm_request_paid', r, 'payment_requests') }]);
    for (const i of invs.filter((x) => ['Sent', 'Partial', 'Overdue'].includes(x.status) && x.due_date && x.due_date < t0 && balanceOf(x) > 0).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)))
      add(-dd(i.due_date) > 7 ? 3 : 2, '🧾', `${i.number} is ${-dd(i.due_date)} days overdue · ${money(balanceOf(i))}`, lbl('clients', i.client_id), [{ l: '⏰ Remind', f: run('whatsapp_reminder', i, 'invoices') }, { l: '📨 Request', f: run('payment_request', i, 'invoices') }]);
    for (const i of invs.filter((x) => ['Sent', 'Partial'].includes(x.status) && x.due_date && dd(x.due_date) >= 0 && dd(x.due_date) <= 2 && balanceOf(x) > 0))
      add(1, '🧾', `${i.number} due ${when(dd(i.due_date))} · ${money(balanceOf(i))}`, lbl('clients', i.client_id), [{ l: '⏰ Remind', f: run('whatsapp_reminder', i, 'invoices') }]);
    const mk = t0.slice(0, 7), dayN = +t0.slice(8, 10);
    for (const p of pkgs.filter((x) => x.status === 'Active' && x.monthly_fee && x.billing_day && dayN >= x.billing_day && !invs.some((i) => String(i.package_id) === String(x.id) && String(i.issue_date).startsWith(mk))))
      add(2, '📦', `Retainer invoice not raised: ${lbl('clients', p.client_id)} · ${p.name}`, `Billing day was the ${p.billing_day}${[, 'st', 'nd', 'rd'][p.billing_day % 10 > 3 || [11, 12, 13].includes(p.billing_day % 100) ? 0 : p.billing_day % 10] || 'th'} · ${money(p.monthly_fee)}`, [{ l: '🧾 Raise invoice', f: run('raise_invoice', p, 'packages') }]);
    for (const k of contracts.filter((x) => x.status === 'Sent')) add(1, '✍️', `Waiting for signature: ${k.title}`, lbl('clients', k.client_id), [{ l: '💬 Send again', f: run('share_contract', k, 'contracts') }]);
  }
  for (const i of items.filter((x) => x.status !== 'Published' && mineI(x))) {
    const n = i.publish_date ? dd(i.publish_date) : null;
    const who = lbl('clients', i.client_id);
    if (n !== null && n < 0) add(3, '📤', `Overdue post: ${i.title}`, `${who} · was due ${when(n)} · stage ${i.status}`, [{ l: '📤 Posting pack', f: run('post_pack', i, 'content_items') }, { l: 'Open', f: open('content_items', i) }]);
    else if (n === 0) add(2, '📤', `Going live today: ${i.title}`, `${who} · ${i.status}`, [{ l: '📤 Posting pack', f: run('post_pack', i, 'content_items') }]);
    else if (n !== null && n <= 3 && PRE.includes(i.status)) add(n <= 1 ? 3 : 2, '⚠️', `At risk: ${i.title} goes live ${when(n)} but is still “${i.status}”`, `${who}${i.editor_id || i.designer_id || i.writer_id ? '' : ' · nobody assigned'}`, [{ l: 'Open', f: open('content_items', i) }]);
    if (i.client_status === 'Sent to client' && n !== null && n <= 3) add(n <= 1 ? 3 : 2, '⏳', `Client hasn't approved: ${i.title}`, `${who} · goes live ${when(n)}`, isMgr ? [{ l: '✅ Nudge client', f: run('approval_link', i, 'content_items') }] : []);
    if (i.client_status === 'Changes requested') add(2, '✏️', `Client wants changes: ${i.title}`, `${who} · ${String(i.client_feedback || '').split('\n').pop().slice(0, 120)}`, [{ l: 'Open', f: open('content_items', i) }]);
  }
  for (const s of shoots.filter((x) => ['Planned', 'Confirmed'].includes(x.status) && x.shoot_date && dd(x.shoot_date) >= 0 && dd(x.shoot_date) <= 2)) {
    const crew = arr(s.crew_ids), missing = [!s.director_id && !crew.length && 'crew', !s.call_time && 'call time', !s.location && 'location', !items.some((i) => String(i.shoot_id) === String(s.id)) && 'content attached'].filter(Boolean);
    if (missing.length) add(2, '🎬', `Shoot ${when(dd(s.shoot_date))} is missing: ${missing.join(', ')}`, s.title, [{ l: 'Open', f: open('shoots', s) }]);
    else add(1, '🎬', `Shoot ${when(dd(s.shoot_date))}: ${s.title}`, `${s.call_time || ''} · ${s.location || ''}`, [{ l: '🖨 Call sheet', f: run('call_sheet', s, 'shoots') }]);
  }
  const late = tasks.filter((t) => t.status !== 'Done' && t.due_date && t.due_date < t0 && (isMgr || t.assignee_id === me)), byU = {};
  late.forEach((t) => (byU[t.assignee_id] ||= []).push(t));
  for (const [u, ts] of Object.entries(byU)) add(2, '✅', `${u === me ? 'You have' : (lbl('users', u) || 'Someone') + ' has'} ${ts.length} overdue task${ts.length > 1 ? 's' : ''}`, ts.slice(0, 3).map((t) => t.title).join(' · '), [{ l: 'View tasks', f: () => (location.hash = '#/tasks') }]);
  for (const g of gear.filter((x) => !x.returned_on && x.due_back && x.due_back < t0)) add(2, '🎒', `Equipment overdue: ${lbl('assets', g.asset_id) || 'item'} (${lbl('users', g.user_id) || 'someone'})`, `was due back ${when(dd(g.due_back))}`, [{ l: '↩ Mark returned', f: run('mark_returned', g, 'equipment_log') }]);
  const empty = items.filter((i) => i.status === 'Idea' && !i.concept && i.publish_date && dd(i.publish_date) >= 0 && dd(i.publish_date) <= 14 && mineI(i)), byC = {};
  empty.forEach((i) => (byC[i.client_id] ||= []).push(i));
  for (const [c, is] of Object.entries(byC)) add(1, '💡', `${is.length} slot${is.length > 1 ? 's' : ''} in the next 2 weeks still have no idea: ${lbl('clients', c)}`, is.slice(0, 3).map((i) => i.title).join(' · '), [{ l: 'Open calendar', f: () => (location.hash = '#/content_items') }]);
  needs.sort((a, b) => b.sev - a.sev);

  // ----- client health (managers) -----
  const mk2 = t0.slice(0, 7), dim = new Date(+t0.slice(0, 4), +t0.slice(5, 7), 0).getDate(), dayN2 = +t0.slice(8, 10), VID = ['Reel', 'YouTube video', 'YouTube Short'];
  const ago = (n) => iso(new Date(Date.now() - n * 864e5)), avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const health = (lookups.clients || []).map((c) => {
    const cid = String(c.id), ci = items.filter((i) => String(i.client_id) === cid), pk = pkgs.find((p) => String(p.client_id) === cid && p.status === 'Active');
    const active = !!pk || ci.some((i) => i.status !== 'Published') || invs.some((i) => String(i.client_id) === cid && ['Sent', 'Partial', 'Overdue'].includes(i.status));
    if (!active) return null;
    const reasons = [], parts = {};
    const vids = ci.filter((i) => i.status === 'Published' && VID.includes(i.format) && String(i.posted_on || i.publish_date).startsWith(mk2)).length;
    if (pk?.videos_per_month) { const exp = Math.ceil((pk.videos_per_month * dayN2) / dim), r = exp ? Math.min(1, vids / exp) : 1; parts.delivery = Math.round(30 * r); if (r < 0.8) reasons.push(`${Math.max(exp - vids, 1)} video${exp - vids > 1 ? 's' : ''} behind plan`); } else parts.delivery = 24;
    const od = invs.filter((i) => String(i.client_id) === cid && ['Sent', 'Partial', 'Overdue'].includes(i.status) && i.due_date && i.due_date < t0 && balanceOf(i) > 0), odAmt = od.reduce((s, i) => s + balanceOf(i), 0), maxLate = Math.max(0, ...od.map((i) => -dd(i.due_date)));
    parts.pay = odAmt ? Math.max(0, Math.round(25 - 5 - maxLate * 0.5)) : 25; if (odAmt) reasons.push(`${money(odAmt)} overdue${maxLate > 7 ? ` (${maxLate} days)` : ''}`);
    const waiting = ci.filter((i) => i.client_status === 'Sent to client' && i.status !== 'Published' && i.publish_date && dd(i.publish_date) <= 3).length;
    parts.appr = Math.max(0, 20 - 5 * waiting); if (waiting) reasons.push(`${waiting} approval${waiting > 1 ? 's' : ''} waiting`);
    const plannedNext = ci.filter((i) => i.status !== 'Published' && i.publish_date && dd(i.publish_date) >= 0 && dd(i.publish_date) <= 14).length;
    const expNext = pk ? ((pk.videos_per_month || 0) + (pk.posts_per_month || 0)) * (14 / 30) : 0;
    parts.pipe = expNext ? Math.round(15 * Math.min(1, plannedNext / expNext)) : 11; if (expNext && plannedNext < expNext * 0.6) reasons.push(`only ${plannedNext} pieces planned for the next 2 weeks`);
    const v1 = avg(ci.filter((i) => i.views != null && (i.posted_on || '') >= ago(30)).map((i) => +i.views)), v0 = avg(ci.filter((i) => i.views != null && (i.posted_on || '') >= ago(60) && (i.posted_on || '') < ago(30)).map((i) => +i.views));
    parts.eng = v1 != null && v0 ? Math.round(10 * Math.min(1, v1 / v0)) : 7; if (v1 != null && v0 && v1 < v0 * 0.7) reasons.push(`views down ${Math.round((1 - v1 / v0) * 100)}% vs last month`);
    const score = Object.values(parts).reduce((s, x) => s + x, 0);
    const nextShoot = shoots.filter((s) => String(s.client_id) === cid && s.shoot_date >= t0 && s.status !== 'Cancelled').sort((a, b) => (a.shoot_date < b.shoot_date ? -1 : 1))[0];
    return { c, score, reasons, vids, pk, odAmt, waiting, nextShoot };
  }).filter(Boolean).sort((a, b) => a.score - b.score);

  // ----- insights -----
  const pub = items.filter((i) => i.status === 'Published' && i.views != null && (i.posted_on || i.publish_date) >= ago(90));
  const group = (keyFn) => { const m = {}; pub.forEach((i) => { const k = keyFn(i); if (k) (m[k] ||= []).push(+i.views || 0); }); return Object.entries(m).map(([k, v]) => ({ k, n: v.length, avg: avg(v) })).sort((a, b) => b.avg - a.avg); };
  const byFormat = group((i) => i.format), byDay = group((i) => DAYS[(new Date((i.posted_on || i.publish_date) + 'T00:00:00').getDay() + 6) % 7]), byPlat = group((i) => i.platform), byPillar = group((i) => i.pillar);
  const bars = (rows, unit = '') => { const mx = Math.max(1, ...rows.map((r) => r.avg)); return rows.map((r) => `<div class="row" style="gap:12px"><span style="width:130px">${esc(r.k)}<br><small style="color:var(--mute)">${r.n} post${r.n > 1 ? 's' : ''}</small></span><div style="flex:1"><div class="bar2" style="width:${Math.max(3, (r.avg / mx) * 100)}%"></div></div><b style="width:80px;text-align:right">${new Intl.NumberFormat('en-IN').format(Math.round(r.avg))}${unit}</b></div>`).join(''); };
  const tips = [];
  if (byFormat.length > 1) { const a = byFormat[0], z = byFormat[byFormat.length - 1]; if (z.avg > 0) tips.push(`<b>${esc(a.k)}</b> average ${(a.avg / z.avg).toFixed(1)}× the views of <b>${esc(z.k)}</b>. Plan more of the first.`); }
  if (byDay.filter((d) => d.n >= 2).length > 1) tips.push(`Best posting day so far: <b>${esc(byDay.filter((d) => d.n >= 2)[0].k)}</b>.`);
  if (byPillar.length > 1) tips.push(`Strongest content pillar: <b>${esc(byPillar[0].k)}</b>.`);
  const top = [...pub].sort((a, b) => (+b.views || 0) - (+a.views || 0)).slice(0, 5);

  const sevCls = { 3: 'bad', 2: 'warn', 1: 'info' }, cnt = (s) => needs.filter((n) => n.sev === s).length;
  const tabs = [['needs', `Needs attention (${needs.length})`], ...(isMgr ? [['health', 'Client health']] : []), ['insights', "What's working"]];
  let tab = 'needs';
  const draw = () => {
    let body = '';
    if (tab === 'needs') {
      body = needs.length ? `<div class="grid" style="margin-bottom:12px"><div class="panel kpi"><small>Urgent</small><div class="v" style="color:var(--bad)">${cnt(3)}</div></div><div class="panel kpi"><small>Soon</small><div class="v" style="color:var(--warn)">${cnt(2)}</div></div><div class="panel kpi"><small>Heads-up</small><div class="v" style="color:var(--info)">${cnt(1)}</div></div></div>`
        + needs.map((n, i) => `<div class="need ${sevCls[n.sev]}"><div class="nt"><span class="ni">${n.icon}</span><span><b>${esc(n.title)}</b><br><small style="color:var(--mute)">${esc(n.detail || '')}</small></span></div><div class="na">${n.actions.map((a, j) => `<button class="btn ${j ? 'ghost' : ''} sm" data-i="${i}" data-j="${j}">${esc(a.l)}</button>`).join('')}</div></div>`).join('')
        : '<div class="empty">🎉 Nothing needs you right now. Enjoy the quiet.</div>';
    } else if (tab === 'health') {
      body = `<div class="tw"><table><thead><tr><th>Client</th><th>Health</th><th>Videos this month</th><th>Overdue</th><th>Next shoot</th><th>Why</th><th></th></tr></thead><tbody>${health.map((h, i) => { const cls = h.score >= 75 ? 'ok' : h.score >= 50 ? 'warn' : 'bad', lab = h.score >= 75 ? 'Healthy' : h.score >= 50 ? 'Watch' : 'At risk'; return `<tr style="cursor:default"><td><b>${esc(h.c.label)}</b></td><td><span class="tag ${cls}">${h.score} · ${lab}</span></td><td>${h.pk?.videos_per_month ? `${h.vids} / ${h.pk.videos_per_month}` : h.vids}</td><td>${h.odAmt ? money(h.odAmt) : '—'}</td><td>${h.nextShoot ? esc(NICE_DATE(h.nextShoot.shoot_date)) : '—'}</td><td style="white-space:normal;min-width:200px">${h.reasons.map(esc).join(' · ') || '<span style="color:var(--mute)">All good</span>'}</td><td><button class="btn ghost sm" data-hp="${i}">🔗 Portal</button> <button class="btn ghost sm" data-hr="${i}">📈 Report</button></td></tr>`; }).join('') || '<tr><td colspan="7" style="color:var(--mute)">No active clients yet</td></tr>'}</tbody></table></div>
        <p style="color:var(--mute);font-size:12px">Score out of 100: videos delivered vs package (30), payments on time (25), client approvals not stuck (20), content planned for the next 2 weeks (15), views trend (10).</p>`;
    } else {
      body = pub.length >= 3 ? `${tips.length ? `<div class="panel" style="margin-bottom:12px;border-color:var(--brand)"><h3>💡 What the numbers say</h3>${tips.map((t) => `<p style="margin:6px 0">${t}</p>`).join('')}</div>` : ''}
        <div class="stack" style="margin-top:0"><div class="panel"><h3>Average views by format</h3>${bars(byFormat)}</div><div class="panel"><h3>Average views by day posted</h3>${bars(byDay)}</div>
        ${byPlat.length > 1 ? `<div class="panel"><h3>By platform</h3>${bars(byPlat)}</div>` : ''}${byPillar.length > 1 ? `<div class="panel"><h3>By content pillar</h3>${bars(byPillar)}</div>` : ''}</div>
        <div class="panel" style="margin-top:14px"><h3>🏆 Top posts (last 90 days)</h3>${top.map((i) => `<div class="row"><span>${esc(i.title)}<br><small style="color:var(--mute)">${esc([lbl('clients', i.client_id), i.format, i.platform].filter(Boolean).join(' · '))}</small></span><b>${new Intl.NumberFormat('en-IN').format(i.views)} views</b></div>`).join('')}</div>`
        : '<div class="empty">Insights appear once at least 3 published posts have results (views) filled in. Add views, likes and reach on each published item.</div>';
    }
    view.innerHTML = `<div class="seg" style="margin-bottom:14px">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>${body}`;
    view.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    view.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => needs[b.dataset.i].actions[b.dataset.j].f()));
    view.querySelectorAll('[data-hp]').forEach((b) => (b.onclick = async () => { const c = (await api('/e/clients')).find((x) => String(x.id) === String(health[b.dataset.hp].c.id)); ACTIONS.share_portal.run(c).catch((e) => toast(e.message)); }));
    view.querySelectorAll('[data-hr]').forEach((b) => (b.onclick = async () => { const c = (await api('/e/clients')).find((x) => String(x.id) === String(health[b.dataset.hr].c.id)); ACTIONS.client_report.run(c); }));
  };
  draw();
}

// ---------- production panels on the dashboard ----------
async function productionPanels(view) {
  if (!meta.entities.content_items) return;
  let items, shoots = [];
  try { [items, shoots] = await Promise.all([api('/e/content_items'), meta.entities.shoots ? api('/e/shoots') : []]); await lookup('clients'); } catch { return; }
  const t0 = today(), wk = addDays(7), fortnight = addDays(14), open = items.filter((i) => i.status !== 'Published');
  const stages = meta.entities.content_items.fields.find((f) => f.k === 'status').opts.filter((o) => o !== 'Published');
  const late = open.filter((i) => i.publish_date && i.publish_date < t0).length, me = meta.user.id;
  const mine = open.filter((i) => [i.writer_id, i.editor_id, i.designer_id, i.owner_id].includes(me)).sort((a, b) => (a.publish_date || '9') < (b.publish_date || '9') ? -1 : 1).slice(0, 7);
  const goLive = open.filter((i) => i.publish_date >= t0 && i.publish_date <= wk).sort((a, b) => (a.publish_date < b.publish_date ? -1 : 1)).slice(0, 7);
  const up = shoots.filter((s) => s.shoot_date >= t0 && s.shoot_date <= fortnight && !['Completed', 'Cancelled'].includes(s.status)).sort((a, b) => (a.shoot_date < b.shoot_date ? -1 : 1)).slice(0, 6);
  const line = (i) => `<div class="row"><span><a href="#/content_items">${esc(i.title)}</a><br><small style="color:var(--mute)">${esc([lbl('clients', i.client_id), i.format, i.publish_date].filter(Boolean).join(' · '))}</small></span>${tag(i.status)}</div>`;
  view.insertAdjacentHTML('beforeend', `<div class="panel" style="margin-top:14px"><h3>🎬 Content pipeline ${late ? `<span class="tag bad">${late} overdue</span>` : ''}</h3>
    <div class="pipe">${stages.map((st) => [st, open.filter((i) => i.status === st).length]).filter(([, n]) => n).map(([st, n]) => `<a href="#/content_items"><b>${n}</b>${esc(st)}</a>`).join('') || '<span style="color:var(--mute)">Nothing in production — create a content plan to start.</span>'}</div></div>
    <div class="stack"><div class="panel"><h3>Shoots — next 14 days</h3>${up.map((s) => `<div class="row"><span><a href="#/shoots">${esc(s.title)}</a><br><small style="color:var(--mute)">${esc(s.shoot_date)}${s.call_time ? ' · ' + esc(s.call_time) : ''}${s.location ? ' · ' + esc(s.location) : ''}</small></span>${tag(s.status)}</div>`).join('') || '<div style="color:var(--mute)">No shoots scheduled</div>'}</div>
    <div class="panel"><h3>Going live this week</h3>${goLive.map(line).join('') || '<div style="color:var(--mute)">Nothing scheduled this week</div>'}</div>
    <div class="panel"><h3>My content work</h3>${mine.map(line).join('') || '<div style="color:var(--mute)">Nothing assigned to you</div>'}</div></div>`);
}

function invoiceDoc(inv, co, client, kind = 'invoice') {
  const isQ = kind === 'quote';
  let items = []; try { items = typeof inv.items === 'string' ? JSON.parse(inv.items || '[]') : inv.items || []; } catch {}
  let deds = inv.deductions; if (typeof deds === 'string') { try { deds = JSON.parse(deds); } catch { deds = []; } } deds = deds || [];
  const amt = (i) => (i.amount != null && i.amount !== '' ? +i.amount : (+i.qty || 0) * (+i.rate || 0));
  const inr = (n) => '₹ ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const num = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const nl = (t) => esc(t || '').replace(/\n/g, '<br>');
  const dt = inv.issue_date ? new Date(inv.issue_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const sub = items.reduce((s, i) => s + amt(i), 0), tax = sub * (+inv.tax_percent || 0) / 100;
  const tp = +inv.tax_percent || 0, gstSplit = tax && !isQ && /^CGST/.test(inv.gst_mode || ''), gstIgst = tax && !isQ && /^IGST/.test(inv.gst_mode || ''), taxInv = gstSplit || gstIgst;
  const hasDel = inv.videos_committed !== null && inv.videos_committed !== undefined && inv.videos_committed !== '';
  const com = +inv.videos_committed || 0, del = +inv.videos_delivered || 0, pipe = Math.max(com - del, 0);
  const hasCF = inv.carry_forward !== null && inv.carry_forward !== undefined && inv.carry_forward !== '';
  const bank = co.bank || {}, logo = new URL('icons/logo.png', location.href).href;
  const notes = String(inv.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const company = co.name || 'Redeye Digital Solutions';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number || 'Invoice')}</title><style>
  @page{size:A4;margin:14mm 14mm}
  *{box-sizing:border-box}body{font:13px/1.45 Georgia,'Times New Roman',serif;color:#1a1a1a;margin:0;padding:24px 28px;-webkit-print-color-adjust:exact;print-color-adjust:exact;max-width:800px;margin:0 auto}
  .red{color:#e03a2f}.hd{border-bottom:1.5px solid #e8685d;padding-bottom:10px}.hd img{height:62px;display:block}
  .ds{letter-spacing:3.5px;font-weight:bold;font-size:10.5px;margin-top:6px}.tg{font-style:italic;font-size:11px;color:#444}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-top:26px}
  h1{margin:6px 0 0;color:#e03a2f;font-size:30px;letter-spacing:.5px}
  .meta td{padding:1px 0;font-size:11.5px}.meta td:first-child{color:#666;padding-right:30px}.meta td:last-child{font-weight:bold;max-width:200px}
  .cols{display:flex;gap:44px;margin-top:22px}.cols>div{flex:1}
  .lab{color:#e03a2f;font-weight:bold;letter-spacing:2px;font-size:11px;margin-bottom:5px}
  table.t{width:100%;border-collapse:collapse;margin-top:26px}
  .t th{background:#1a1a1a;color:#fff;text-align:left;padding:6px 8px;font-size:11px;border-right:2px solid #fff}
  .t td{padding:8px;border:1px solid #ddd;vertical-align:top}.t td.a{text-align:right;font-weight:bold;white-space:nowrap}.t small{display:block;font-style:italic;color:#666;font-size:10.5px;margin-top:2px}
  .t th.c,.t td.c{text-align:center;font-weight:bold}.g{background:#eaf5ea;color:#2a7d2e}.gr{background:#eee}.p{background:#fbe9e7;color:#d6392d}
  .sec{margin-top:26px}
  .tot{margin:22px 0 0 auto;width:340px;border-collapse:collapse}.tot td{padding:5px 8px;border-bottom:1px solid #ddd}.tot td:last-child{text-align:right;white-space:nowrap}
  .tot .dk td{background:#1a1a1a;color:#fff;font-weight:bold;border:0}.tot .dk td:last-child{color:#ff5a4d}.neg{color:#d6392d}
  ul{margin:4px 0 0;padding-left:30px;color:#444;font-size:11.5px}li{margin:3px 0}
  .ft{margin-top:26px;border-top:1px solid #ddd;padding-top:12px}.ft img{height:50px;display:block;margin:6px 0 2px}
  @media print{body{padding:0}}
  </style></head><body>
  <div class="hd"><img src="${logo}" alt="Redeye"><div class="ds">DIGITAL SOLUTIONS</div><div class="tg">“${esc(co.tagline || 'Content that catches the eye.')}”</div></div>
  <div class="top"><h1>${isQ ? 'QUOTATION' : taxInv ? 'TAX INVOICE' : 'INVOICE'}</h1>
   <table class="meta"><tr><td>${isQ ? 'Quote No.' : 'Invoice No.'}</td><td>${esc(inv.number || '')}</td></tr><tr><td>${isQ ? 'Date' : 'Invoice Date'}</td><td>${esc(dt)}</td></tr>${isQ ? `${inv.title ? `<tr><td>Subject</td><td>${esc(inv.title)}</td></tr>` : ''}${inv.valid_until ? `<tr><td>Valid until</td><td>${esc(inv.valid_until)}</td></tr>` : ''}` : inv.client_ref ? `<tr><td>Client Ref.</td><td>${esc(inv.client_ref)}</td></tr>` : ''}</table></div>
  <div class="cols"><div><div class="lab">FROM</div><b>${esc(company)}</b><br>${(co.address || []).map(esc).join('<br>')}${co.gstin ? `<br>GSTIN: ${esc(co.gstin)}` : ''}${co.email ? `<br>Email: ${esc(co.email)}` : ''}${co.phone ? `<br>Phone: ${esc(co.phone)}` : ''}</div>
   <div><div class="lab">BILL TO</div><b>${esc(client.name || lbl('clients', inv.client_id))}</b><br>${nl(client.address)}${client.gstin ? `<br>GSTIN: ${esc(client.gstin)}` : ''}</div></div>
  <table class="t"><thead><tr><th style="width:34px">#</th><th>Description of Services</th><th style="width:30%">Amount (INR)</th></tr></thead><tbody>
   ${items.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.desc)}</b>${i.note ? `<small>${esc(i.note)}</small>` : ''}</td><td class="a">${num(amt(i))}</td></tr>`).join('')}</tbody></table>
  ${hasDel ? `<div class="sec"><div class="lab">DELIVERY STATUS</div><table class="t" style="margin-top:6px"><thead><tr><th>Videos Committed</th><th>Delivered</th><th>In Pipeline</th></tr></thead><tbody><tr><td class="c">${com}</td><td class="c ${del >= com && com ? 'g' : 'gr'}">${del}</td><td class="c ${pipe ? 'p' : 'gr'}">${pipe}</td></tr></tbody></table></div>` : ''}
  <table class="tot"><tr><td>${tax || deds.length ? 'Total Amount' : 'Total'}</td><td>${inr(sub)}</td></tr>
   ${tax ? (gstSplit ? `<tr><td>CGST (${tp / 2}%)</td><td>${inr(tax / 2)}</td></tr><tr><td>SGST (${tp / 2}%)</td><td>${inr(tax / 2)}</td></tr>` : gstIgst ? `<tr><td>IGST (${tp}%)</td><td>${inr(tax)}</td></tr>` : `<tr><td>Tax (${esc(inv.tax_percent)}%)</td><td>${inr(tax)}</td></tr>`) : ''}
   ${deds.map((d) => `<tr><td>${esc(d.label)}</td><td class="neg">– ${inr(d.amount)}</td></tr>`).join('')}
   <tr class="dk"><td>${isQ ? 'Total' : 'Payable Now'}</td><td>${inr(inv.total)}</td></tr>
   ${hasCF ? `<tr><td>Balance Carried Forward</td><td>${inr(inv.carry_forward)}</td></tr>` : ''}</table>
  ${!isQ && bank.account ? `<div class="sec"><div class="lab">PAYMENT DETAILS</div>Account Holder Name: ${esc(bank.holder)}<br>Bank Name: ${esc(bank.bank)}<br>Branch: ${esc(bank.branch)}<br>Account Number: ${esc(bank.account)}<br>IFSC Code: ${esc(bank.ifsc)}</div>` : ''}
  ${notes.length ? `<div class="sec"><div class="lab">NOTES</div><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
  <div class="ft">For ${esc(company)}${co.signature ? `<img src="${esc(co.signature)}" alt="">` : '<br><br>'}<br><b>${esc(co.signatory || 'Authorized Signatory')}</b></div>
  </body></html>`;
}

async function printInvoice(inv, kind = 'invoice') {
  const isQ = kind === 'quote';
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write('<p style="font:14px system-ui;padding:24px">Preparing…</p>');
  let co = {}, client = {};
  try { co = await api('/company'); } catch {}
  try { client = (await api('/e/clients')).find((c) => String(c.id) === String(inv.client_id)) || {}; } catch {}
  if (isQ && !client.name && inv.lead_id) { try { const l = (await api('/e/leads')).find((x) => String(x.id) === String(inv.lead_id)); client = { name: l?.company || l?.name }; } catch {} }
  const html = invoiceDoc(inv, co, client, kind);
  w.document.open();
  w.document.write(html);
  w.document.close(); w.focus();
  const im = w.document.querySelector('img'); const go = () => setTimeout(() => w.print(), 250);
  if (im && !im.complete) { im.onload = go; im.onerror = go; } else go();
}

// ---------- settings ----------
function settings(view) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `<div class="set">
   <div class="panel"><h3>🔔 Push notifications</h3><p>Get alerts for task assignments, leave &amp; expense approvals, new tickets, overdue invoices — even when the app is closed.</p>
     <div id="ps">${supported ? `<button class="btn" id="pe">Enable on this device</button> <button class="btn ghost" id="pt">Send test</button>` : '<span class="tag warn">Not supported in this browser</span>'}</div>
     ${ios && !standalone ? '<p><b>iPhone/iPad:</b> notifications need the app installed first: Share → “Add to Home Screen”, then open it from the home screen and enable here (iOS 16.4+).</p>' : ''}</div>
   <div class="panel"><h3>📲 Install the app</h3><p>Use Redeye ERP like a native app on Windows, Mac, Android and iOS.</p>
     ${installEvt ? '<button class="btn" id="inst">Install now</button>' : standalone ? '<span class="tag ok">Already installed</span>' : `<p>Chrome/Edge (Windows, Mac, Android): menu → <b>Install Redeye ERP</b>.<br>Safari on Mac: File → <b>Add to Dock</b>. iPhone/iPad Safari: Share → <b>Add to Home Screen</b>.</p>`}</div>
   <div class="panel"><h3>🔑 Change password</h3><form id="pw"><div style="display:grid;gap:10px"><input type="password" name="current" placeholder="Current password" autocomplete="current-password" required><input type="password" name="next" placeholder="New password (min 8)" autocomplete="new-password" required><div class="err" id="pe2"></div><button class="btn">Update password</button></div></form></div></div>`;
  view.querySelector('.set').insertAdjacentHTML('beforeend', `<div class="panel"><h3>📅 Calendar feed</h3><p>Show your shoots, posts, tasks and meetings in Google or Apple Calendar on your phone.</p><button class="btn" id="calb">Show my calendar link</button><div id="calo"></div></div>
    ${meta.user.role === 'admin' ? '<div class="panel"><h3>🏢 Company &amp; invoice details</h3><p>Name, address, GSTIN and bank details printed on invoices.</p><button class="btn" id="cob">Edit details</button></div>' : ''}`);
  $('#calb').onclick = async () => {
    try {
      const tok = await api('/calendar/token'), url = `${SUPABASE_URL}/functions/v1/calendar-feed?token=${tok}`;
      $('#calo').innerHTML = `<input readonly value="${esc(url)}" style="margin-top:10px" onclick="this.select()"><p><b>Google Calendar:</b> Other calendars → + → From URL → paste. <b>iPhone / Mac:</b> Calendar → File → New Calendar Subscription → paste. Keep this link private.</p><button class="btn ghost sm" id="calc">Copy link</button>`;
      $('#calc').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Select and copy the link'); } };
    } catch (err) { toast(err.message); }
  };
  if ($('#cob')) $('#cob').onclick = companyEditor;
  if ($('#pe')) $('#pe').onclick = () => enablePush(false);
  if ($('#pt')) $('#pt').onclick = async () => { await api('/push/test', { method: 'POST' }); toast('Test sent'); };
  if ($('#inst')) $('#inst').onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; route(); };
  $('#pw').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); ev.target.reset(); $('#pe2').textContent = ''; toast('Password updated'); }
    catch (err) { $('#pe2').textContent = err.message; }
  };
}
async function enablePush(silent) {
  try {
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') { if (!silent) toast('Permission denied. Allow notifications in browser settings.'); return false; }
    const reg = await navigator.serviceWorker.ready, { key } = await api('/push/key');
    if (!key || key.includes('YOUR-')) throw new Error('Push is not configured yet');
    const pad = '='.repeat((4 - (key.length % 4)) % 4), raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    if (!silent) toast('Notifications enabled on this device');
    return true;
  } catch (err) { if (!silent) toast('Could not enable: ' + err.message); return false; }
}

// Pop-up shown right after every sign-in until notifications are enabled on this browser/device.
// (Browsers only allow the permission box from a click, so the pop-up has an Enable button.)
async function pushPrompt() {
  try {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const { key } = await api('/push/key');
    const demo = !key;                                                     // demo build has no push service
    if (!demo && key.includes('YOUR-')) return;                            // push not configured yet
    if (supported && !demo && Notification.permission === 'granted') { enablePush(true); return; }   // register THIS browser quietly
    if (document.querySelector('.pushask')) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const denied = supported && !demo && Notification.permission === 'denied', needInstall = ios && !standalone;
    setTimeout(() => {
      const ov = document.createElement('div'); ov.className = 'ov pushask';
      ov.innerHTML = `<div class="modal" style="max-width:440px" role="dialog" aria-label="Enable notifications"><div class="body" style="display:block;text-align:center;padding:30px 26px 10px">
        <div style="font-size:46px">🔔</div><h3 style="margin:10px 0 8px;font-size:21px">Turn on notifications</h3>
        <p style="color:var(--mute);margin:0 0 8px">Get an instant alert when a task is assigned to you or updated — on every browser and device you sign in from, even when Redeye ERP is closed.</p>
        ${demo ? '<p><span class="tag warn">Demo</span> Real push alerts work in the live app once it is connected.</p>' : ''}
        ${denied ? '<p><b>Notifications are blocked for this site.</b> Click the 🔒 icon next to the address bar → Notifications → Allow, then reload.</p>' : ''}
        ${needInstall ? '<p><b>iPhone/iPad:</b> first tap Share → “Add to Home Screen”, open the app from your home screen, then enable notifications.</p>' : ''}
        ${!supported && !demo ? '<p><span class="tag warn">This browser does not support push notifications</span></p>' : ''}</div>
        <footer style="justify-content:center">${needInstall || denied || (!supported && !demo) ? '' : '<button class="btn" id="pk-yes">Enable notifications</button>'}<button class="btn ghost" id="pk-no">${denied || needInstall ? 'Close' : 'Not now'}</button></footer></div>`;
      document.body.append(ov);
      const close = () => ov.remove();
      $('#pk-no', ov).onclick = close;
      if ($('#pk-yes', ov)) $('#pk-yes', ov).onclick = async () => {
        if (demo) { toast('Demo only — push works in the live app'); return close(); }
        const ok = await enablePush(false); if (ok || Notification.permission === 'denied') close();
      };
    }, 600);
  } catch {}
}

// ---------- start ----------
(async () => {
  if (!configured) {
    $('#root').innerHTML = '<div class="login"><div class="card"><h1>Setup needed</h1><p>Open <code>web/config.js</code> and paste your Supabase project URL, anon key and VAPID public key. See README.md.</p></div></div>';
    return;
  }
  const pv = location.hash.match(/^#\/view\/(inv|quote)\/([0-9a-f-]{36})$/i);
  if (pv) return renderPublicDoc(pv[1], pv[2]);
  const pc = location.hash.match(/^#\/view\/contract\/([0-9a-f-]{36})$/i); if (pc) return renderContractPage(pc[1]);
  const pa = location.hash.match(/^#\/approve\/(item|plan)\/([0-9a-f-]{36})$/i); if (pa) return renderApproval(pa[1], pa[2]);
  const pp = location.hash.match(/^#\/portal\/([0-9a-f-]{36})$/i); if (pp) return renderPortal(pp[1]);
  const py = location.hash.match(/^#\/pay\/([0-9a-f-]{36})$/i); if (py) return renderPayPage(py[1]);
  const { data: { session } } = await sb.auth.getSession();
  if (recovering && session) return renderSetPassword();
  if (!session) return renderLogin();
  try { await boot(); } catch (err) { /reach the server|Reconnecting/i.test(err.message) ? renderRetry(err.message) : logoutLocal(err.message); }
})();

// shown instead of the login page when the server can't be reached: you stay signed in, just try again
function renderRetry(msg) {
  $('#root').innerHTML = `<div class="login"><div class="card"><img class="logo" src="icons/logo.png" alt="Redeye Digital Solutions"><h1>Can't connect</h1><p>${esc(msg)}</p><button class="btn" id="rt" style="width:100%">Try again</button></div></div>`;
  $('#rt').onclick = async () => { try { await boot(); } catch (err) { renderRetry(err.message); } };
}
