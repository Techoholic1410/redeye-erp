const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCY = 'INR', LOCALE = 'en-IN';
const money = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 }).format(n || 0);
const money2 = (n) => new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(n || 0);
const today = () => new Date().toISOString().slice(0, 10);

import { api, sb, configured } from './data.js';

let meta = null, lookups = {}, notifTimer = null, installEvt = null, notifChannel = null;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = 'none'), 3000); }
function logoutLocal(msg = '') {
  meta = null; clearInterval(notifTimer);
  if (notifChannel) { sb.removeChannel(notifChannel); notifChannel = null; }
  renderLogin(msg);
}
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && meta) logoutLocal(); });

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'refresh-notifications') loadNotifs(); });
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (meta) route(); });

// ---------- login ----------
function renderLogin(msg = '') {
  $('#root').innerHTML = `<div class="login"><form class="card" id="lf">
    <img src="icons/icon-192.png" alt=""><h1>Redeye ERP</h1><p>Redeye Digital Solutions · sign in to continue</p>
    <div class="f"><label>Email</label><input name="email" type="email" autocomplete="username" required autofocus></div>
    <div class="f"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
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
    <aside class="side" id="side"><div class="brand"><img src="icons/icon-192.png" alt="">Redeye ERP</div>
      <nav class="nav" id="nav"></nav>
      <div class="me"><b>${esc(meta.user.name)}</b>${esc(meta.user.role)} · <a href="#" id="lo" style="color:#fff">Sign out</a></div></aside>
    <div class="main"><div class="top"><button class="iconbtn burger" id="bg" aria-label="Menu">☰</button><h2 id="title"></h2>
      <button class="iconbtn" id="bell" aria-label="Notifications">🔔<span class="badge" id="bb" hidden>0</span></button></div>
      <div id="view"></div></div></div>`;
  $('#nav').innerHTML = [['dashboard', '📊', 'Dashboard'], ...Object.entries(meta.entities).map(([k, e]) => [k, e.icon, e.label]), ['settings', '⚙️', 'Settings']]
    .map(([k, i, l]) => `<a href="#/${k}" data-k="${k}"><span>${i}</span>${esc(l)}</a>`).join('');
  $('#lo').onclick = async (e) => { e.preventDefault(); try { await api('/logout', { method: 'POST' }); } catch {} logoutLocal(); };
  $('#bg').onclick = () => toggleSide();
  $('#bell').onclick = openNotifs;
  loadNotifs(); clearInterval(notifTimer); notifTimer = setInterval(loadNotifs, 60000);
  if (notifChannel) sb.removeChannel(notifChannel);
  notifChannel = sb.channel('notifs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => loadNotifs()).subscribe();
  route();
  pushPrompt();
}
function toggleSide(force) {
  const s = $('#side'), open = force ?? !s.classList.contains('open');
  s.classList.toggle('open', open); $('.scrim')?.remove();
  if (open) { const d = document.createElement('div'); d.className = 'scrim'; d.onclick = () => toggleSide(false); document.body.append(d); }
}
window.addEventListener('hashchange', () => meta && route());

async function route() {
  toggleSide(false);
  const k = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === k));
  const view = $('#view');
  try {
    if (k === 'dashboard') { $('#title').textContent = 'Dashboard'; await dashboard(view); }
    else if (k === 'settings') { $('#title').textContent = 'Settings'; settings(view); }
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
}

// ---------- generic module ----------
const TAGS = { ok: ['Active', 'Paid', 'Won', 'Done', 'Approved', 'Completed', 'Resolved', 'Closed', 'Reimbursed', 'In use', 'Yes'], bad: ['Overdue', 'Rejected', 'Lost', 'Urgent', 'Cancelled', 'Left', 'No'], warn: ['Pending', 'High', 'On hold', 'Review', 'Waiting', 'Repair', 'On notice', 'Sent'], info: ['In progress', 'Proposal', 'Contacted', 'Open', 'Planning', 'Medium'] };
function tag(v) { if (v == null || v === '') return ''; const c = Object.keys(TAGS).find((k) => TAGS[k].includes(v)) || ''; return `<span class="tag ${c}">${esc(v)}</span>`; }
async function lookup(to) { if (!lookups[to]) lookups[to] = await api('/lookup/' + to); return lookups[to]; }
const lbl = (to, id) => lookups[to]?.find((x) => x.id === id)?.label ?? '';

function cell(f, row) {
  const v = row[f.k];
  if (f.t === 'ref') return esc(lbl(f.to, v) || (f.k === 'created_by' ? '' : ''));
  if (f.t === 'money') return v == null ? '' : money(v);
  if (f.t === 'select') return tag(v);
  return esc(v);
}
async function entityView(view, key) {
  const e = meta.entities[key];
  const refs = [...new Set(e.fields.filter((f) => f.t === 'ref').map((f) => f.to))];
  await Promise.all([...refs.map(lookup), lookup('users')]);
  const colF = e.cols.map((k) => e.fields.find((f) => f.k === k) || { k, l: k === 'created_by' ? 'Submitted by' : k, t: k === 'created_by' ? 'ref' : 'text', to: 'users' });
  let mode = e.board && localStorage.getItem('mode:' + key) === 'board' ? 'board' : 'table', q = '';
  view.innerHTML = `<div class="bar"><input id="q" placeholder="Search…" type="search">
    ${e.board ? '<button class="btn ghost" id="mode"></button>' : ''}<span class="sp"></span>
    <button class="btn ghost" id="exp">⬇ CSV</button>${e.can.create ? '<button class="btn" id="new">+ New</button>' : ''}</div><div id="data"></div>`;
  async function load() {
    const rows = await api(`/e/${key}?q=${encodeURIComponent(q)}`);
    const box = $('#data');
    if (!rows.length) { box.innerHTML = `<div class="empty">No records yet.</div>`; return; }
    if (mode === 'board') {
      const bf = e.fields.find((f) => f.k === e.board), titleF = e.labelField;
      box.innerHTML = `<div class="board">${bf.opts.map((o) => `<div class="col" data-v="${esc(o)}"><h4>${esc(o)}<span>${rows.filter((r) => r[e.board] === o).length}</span></h4>
        ${rows.filter((r) => r[e.board] === o).map((r) => `<div class="card2" draggable="${e.can.update}" data-id="${r.id}"><b>${esc(r[titleF])}</b><br><small>${esc(e.cols.filter((c) => c !== titleF && c !== e.board).slice(0, 2).map((c) => cell(colF.find((f) => f.k === c), r).replace(/<[^>]+>/g, '')).filter(Boolean).join(' · '))}</small></div>`).join('')}</div>`).join('')}</div>`;
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
          try { await api(`/e/${key}/${row.id}`, { method: 'PUT', body: { ...row, [e.board]: col.dataset.v } }); load(); } catch (err) { toast(err.message); }
        };
      });
    } else {
      box.innerHTML = `<div class="tw"><table><thead><tr>${colF.map((f) => `<th>${esc(f.l)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r) => `<tr data-id="${r.id}">${colF.map((f) => `<td>${cell(f, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      box.querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = () => form(key, rows.find((r) => r.id == tr.dataset.id), load)));
    }
  }
  const setMode = () => { const b = $('#mode'); if (b) b.textContent = mode === 'board' ? '☰ Table view' : '▦ Board view'; };
  setMode();
  if ($('#mode')) $('#mode').onclick = () => { mode = mode === 'board' ? 'table' : 'board'; localStorage.setItem('mode:' + key, mode); setMode(); load(); };
  let tm; $('#q').oninput = (ev) => { clearTimeout(tm); tm = setTimeout(() => { q = ev.target.value; load(); }, 250); };
  $('#exp').onclick = async () => {
    const csv = await api(`/e/${key}/export`), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${key}-${today()}.csv`; a.click();
  };
  if ($('#new')) $('#new').onclick = () => form(key, null, load);
  await load();
}

function form(key, row, after) {
  const e = meta.entities[key], isNew = !row, editable = isNew ? e.can.create : e.can.update;
  const ov = document.createElement('div'); ov.className = 'ov';
  const input = (f) => {
    const v = row?.[f.k] ?? (isNew ? (f.def === 'today' ? today() : f.def ?? '') : ''), dis = !editable || f.ro ? 'disabled' : '';
    if (f.t === 'items') return `<div class="items"><label>${esc(f.l)}</label><div id="li"></div>${dis ? '' : '<button type="button" class="btn ghost sm" id="addli">+ Add line</button>'}<div id="tot" style="text-align:right;margin-top:8px"></div></div>`;
    if (f.t === 'deductions') return `<div class="items"><label>${esc(f.l)}</label><div id="dd"></div>${dis ? '' : '<button type="button" class="btn ghost sm" id="adddd">+ Add deduction</button>'}</div>`;
    const wrap = (inner, full) => `<div class="${full ? 'full' : ''}"><label>${esc(f.l)}${f.req ? ' *' : ''}</label>${inner}</div>`;
    if (f.t === 'textarea') return wrap(`<textarea name="${f.k}" ${dis}>${esc(v)}</textarea>`, 1);
    if (f.t === 'select') return wrap(`<select name="${f.k}" ${dis}><option value=""></option>${f.opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
    if (f.t === 'ref') return wrap(`<select name="${f.k}" ${dis}><option value=""></option>${(lookups[f.to] || []).map((o) => `<option value="${o.id}" ${o.id == v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
    if (f.t === 'money' || f.t === 'number') return wrap(`<input name="${f.k}" type="number" step="any" value="${esc(v)}" ${dis}>`);
    if (f.t === 'date') return wrap(`<input name="${f.k}" type="date" value="${esc(v)}" ${dis}>`);
    if (f.t === 'password') return wrap(`<input name="${f.k}" type="password" autocomplete="new-password" ${dis}>`);
    return wrap(`<input name="${f.k}" type="${f.t === 'email' ? 'email' : f.t === 'tel' ? 'tel' : 'text'}" value="${esc(v)}" ${dis}>`);
  };
  const fields = e.fields.filter((f) => !(isNew && f.auto));
  ov.innerHTML = `<form class="modal"><header><h3>${isNew ? 'New' : 'Edit'} · ${esc(e.label)}</h3><button type="button" class="btn ghost sm" id="x">✕</button></header>
    <div class="body">${fields.map(input).join('')}</div>
    <footer><span id="fe" class="err" style="flex:1;margin:0;align-self:center"></span>
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
  ov.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {};
    new FormData(ev.target).forEach((v, k) => (body[k] = v));
    if (itemsF) { body.items = lines.filter((l) => l.desc || +l.amount).map((l) => ({ desc: l.desc, note: l.note, amount: +l.amount || 0 })); body.deductions = deds.filter((d) => +d.amount).map((d) => ({ label: d.label || 'Received', amount: +d.amount })); }
    try { await api(isNew ? `/e/${key}` : `/e/${key}/${row.id}`, { method: isNew ? 'POST' : 'PUT', body }); close(); toast('Saved'); after(); }
    catch (err) { $('#fe', ov).textContent = err.message; }
  };
  if ($('#del', ov)) $('#del', ov).onclick = async () => {
    if (!confirm('Delete this record permanently?')) return;
    try { await api(`/e/${key}/${row.id}`, { method: 'DELETE' }); close(); toast('Deleted'); after(); } catch (err) { $('#fe', ov).textContent = err.message; }
  };
  if ($('#pr', ov)) $('#pr', ov).onclick = () => printInvoice(row);
}

async function printInvoice(inv) {
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write('<p style="font:14px system-ui;padding:24px">Preparing invoice…</p>');
  let co = {}, client = {};
  try { co = await api('/company'); } catch {}
  try { client = (await api('/e/clients')).find((c) => String(c.id) === String(inv.client_id)) || {}; } catch {}
  let items = []; try { items = typeof inv.items === 'string' ? JSON.parse(inv.items || '[]') : inv.items || []; } catch {}
  let deds = inv.deductions; if (typeof deds === 'string') { try { deds = JSON.parse(deds); } catch { deds = []; } } deds = deds || [];
  const amt = (i) => (i.amount != null && i.amount !== '' ? +i.amount : (+i.qty || 0) * (+i.rate || 0));
  const inr = (n) => '₹ ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const num = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const nl = (t) => esc(t || '').replace(/\n/g, '<br>');
  const dt = inv.issue_date ? new Date(inv.issue_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  const sub = items.reduce((s, i) => s + amt(i), 0), tax = sub * (+inv.tax_percent || 0) / 100;
  const hasDel = inv.videos_committed !== null && inv.videos_committed !== undefined && inv.videos_committed !== '';
  const com = +inv.videos_committed || 0, del = +inv.videos_delivered || 0, pipe = Math.max(com - del, 0);
  const hasCF = inv.carry_forward !== null && inv.carry_forward !== undefined && inv.carry_forward !== '';
  const bank = co.bank || {}, logo = new URL('icons/logo.png', location.href).href;
  const notes = String(inv.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const company = co.name || 'Redeye Digital Solutions';
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number || 'Invoice')}</title><style>
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
  <div class="top"><h1>INVOICE</h1>
   <table class="meta"><tr><td>Invoice No.</td><td>${esc(inv.number || '')}</td></tr><tr><td>Invoice Date</td><td>${esc(dt)}</td></tr>${inv.client_ref ? `<tr><td>Client Ref.</td><td>${esc(inv.client_ref)}</td></tr>` : ''}</table></div>
  <div class="cols"><div><div class="lab">FROM</div><b>${esc(company)}</b><br>${(co.address || []).map(esc).join('<br>')}${co.email ? `<br>Email: ${esc(co.email)}` : ''}${co.phone ? `<br>Phone: ${esc(co.phone)}` : ''}</div>
   <div><div class="lab">BILL TO</div><b>${esc(client.name || lbl('clients', inv.client_id))}</b><br>${nl(client.address)}${client.gstin ? `<br>GSTIN: ${esc(client.gstin)}` : ''}</div></div>
  <table class="t"><thead><tr><th style="width:34px">#</th><th>Description of Services</th><th style="width:30%">Amount (INR)</th></tr></thead><tbody>
   ${items.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.desc)}</b>${i.note ? `<small>${esc(i.note)}</small>` : ''}</td><td class="a">${num(amt(i))}</td></tr>`).join('')}</tbody></table>
  ${hasDel ? `<div class="sec"><div class="lab">DELIVERY STATUS</div><table class="t" style="margin-top:6px"><thead><tr><th>Videos Committed</th><th>Delivered</th><th>In Pipeline</th></tr></thead><tbody><tr><td class="c">${com}</td><td class="c ${del >= com && com ? 'g' : 'gr'}">${del}</td><td class="c ${pipe ? 'p' : 'gr'}">${pipe}</td></tr></tbody></table></div>` : ''}
  <table class="tot"><tr><td>${tax || deds.length ? 'Total Amount' : 'Total'}</td><td>${inr(sub)}</td></tr>
   ${tax ? `<tr><td>Tax (${esc(inv.tax_percent)}%)</td><td>${inr(tax)}</td></tr>` : ''}
   ${deds.map((d) => `<tr><td>${esc(d.label)}</td><td class="neg">– ${inr(d.amount)}</td></tr>`).join('')}
   <tr class="dk"><td>Payable Now</td><td>${inr(inv.total)}</td></tr>
   ${hasCF ? `<tr><td>Balance Carried Forward</td><td>${inr(inv.carry_forward)}</td></tr>` : ''}</table>
  ${bank.account ? `<div class="sec"><div class="lab">PAYMENT DETAILS</div>Account Holder Name: ${esc(bank.holder)}<br>Bank Name: ${esc(bank.bank)}<br>Branch: ${esc(bank.branch)}<br>Account Number: ${esc(bank.account)}<br>IFSC Code: ${esc(bank.ifsc)}</div>` : ''}
  ${notes.length ? `<div class="sec"><div class="lab">NOTES</div><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
  <div class="ft">For ${esc(company)}${co.signature ? `<img src="${esc(co.signature)}" alt="">` : '<br><br>'}<br><b>${esc(co.signatory || 'Authorized Signatory')}</b></div>
  </body></html>`);
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

// Shown once after sign-in on every new browser/device: asks the person to allow notifications.
// Browsers only allow the permission request from a click, so this is a button, not an automatic request.
async function pushPrompt() {
  try {
    if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return;
    const { key } = await api('/push/key');
    if (!key || key.includes('YOUR-')) return;                          // demo / push not configured
    if (Notification.permission === 'granted') { enablePush(true); return; }   // make sure THIS browser is registered
    if (Notification.permission === 'denied') return;
    let until = 0; try { until = +localStorage.getItem('pushSnooze') || 0; } catch {}
    if (Date.now() < until || document.querySelector('.pushask')) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const needInstall = ios && !standalone;
    setTimeout(() => {
      const ov = document.createElement('div'); ov.className = 'ov pushask';
      ov.innerHTML = `<div class="modal" style="max-width:420px" role="dialog" aria-label="Enable notifications"><div class="body" style="display:block;text-align:center;padding:28px 24px 8px">
        <div style="font-size:42px">🔔</div><h3 style="margin:10px 0 6px;font-size:19px">Turn on notifications</h3>
        <p style="color:var(--mute);margin:0 0 6px">Get an alert the moment a task is assigned to you or changes — even when Redeye ERP is closed.</p>
        ${needInstall ? '<p><b>iPhone/iPad:</b> first tap Share → “Add to Home Screen”, open the app from your home screen, then enable notifications.</p>' : ''}</div>
        <footer style="justify-content:center">${needInstall ? '' : '<button class="btn" id="pk-yes">Enable notifications</button>'}<button class="btn ghost" id="pk-no">Not now</button></footer></div>`;
      document.body.append(ov);
      const close = () => ov.remove();
      $('#pk-no', ov).onclick = () => { try { localStorage.setItem('pushSnooze', String(Date.now() + 3 * 864e5)); } catch {} close(); };
      if ($('#pk-yes', ov)) $('#pk-yes', ov).onclick = async () => { const ok = await enablePush(false); if (ok) close(); else if (Notification.permission === 'denied') close(); };
    }, 1200);
  } catch {}
}

// ---------- start ----------
(async () => {
  if (!configured) {
    $('#root').innerHTML = '<div class="login"><div class="card"><h1>Setup needed</h1><p>Open <code>web/config.js</code> and paste your Supabase project URL, anon key and VAPID public key. See README.md.</p></div></div>';
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  try { await boot(); } catch (err) { logoutLocal(err.message); }
})();
