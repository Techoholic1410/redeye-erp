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
    <div class="err" id="le">${esc(msg)}</div><p style="font-size:12px;margin:0 0 12px">DEMO - sample data in your browser. Log in as <b>admin@demo</b>, <b>manager@demo</b> or <b>staff@demo</b> with any password.</p><button class="btn" style="width:100%">Sign in</button></form></div>`;
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

  let lines = [];
  const itemsF = fields.find((f) => f.t === 'items');
  if (itemsF) {
    try { lines = JSON.parse(row?.items || '[]'); } catch {}
    if (!lines.length) lines = [{ desc: '', qty: 1, rate: 0 }];
    const draw = () => {
      $('#li', ov).innerHTML = lines.map((l, i) => `<div class="li"><input data-i="${i}" data-f="desc" placeholder="Description" value="${esc(l.desc)}"><input data-i="${i}" data-f="qty" type="number" step="any" value="${esc(l.qty)}"><input data-i="${i}" data-f="rate" type="number" step="any" value="${esc(l.rate)}"><button type="button" class="btn ghost sm" data-rm="${i}">✕</button></div>`).join('');
      const sub = lines.reduce((s, l) => s + (+l.qty || 0) * (+l.rate || 0), 0), tax = +ov.querySelector('[name=tax_percent]')?.value || 0;
      $('#tot', ov).innerHTML = `Subtotal ${money2(sub)} · Tax ${money2(sub * tax / 100)} · <b>Total ${money2(sub * (1 + tax / 100))}</b>`;
      ov.querySelectorAll('.li input').forEach((inp) => (inp.oninput = () => { lines[inp.dataset.i][inp.dataset.f] = inp.value; recalc(); }));
      ov.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { lines.splice(b.dataset.rm, 1); draw(); }));
    };
    const recalc = () => {
      const sub = lines.reduce((s, l) => s + (+l.qty || 0) * (+l.rate || 0), 0), tax = +ov.querySelector('[name=tax_percent]')?.value || 0;
      $('#tot', ov).innerHTML = `Subtotal ${money2(sub)} · Tax ${money2(sub * tax / 100)} · <b>Total ${money2(sub * (1 + tax / 100))}</b>`;
    };
    draw();
    if ($('#addli', ov)) $('#addli', ov).onclick = () => { lines.push({ desc: '', qty: 1, rate: 0 }); draw(); };
    ov.querySelector('[name=tax_percent]')?.addEventListener('input', recalc);
  }
  ov.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {};
    new FormData(ev.target).forEach((v, k) => (body[k] = v));
    if (itemsF) body.items = lines.filter((l) => l.desc || +l.rate);
    try { await api(isNew ? `/e/${key}` : `/e/${key}/${row.id}`, { method: isNew ? 'POST' : 'PUT', body }); close(); toast('Saved'); after(); }
    catch (err) { $('#fe', ov).textContent = err.message; }
  };
  if ($('#del', ov)) $('#del', ov).onclick = async () => {
    if (!confirm('Delete this record permanently?')) return;
    try { await api(`/e/${key}/${row.id}`, { method: 'DELETE' }); close(); toast('Deleted'); after(); } catch (err) { $('#fe', ov).textContent = err.message; }
  };
  if ($('#pr', ov)) $('#pr', ov).onclick = () => printInvoice(row);
}

function printInvoice(inv) {
  let items = []; try { items = JSON.parse(inv.items || '[]'); } catch {}
  const client = lbl('clients', inv.client_id), w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print');
  w.document.write(`<!doctype html><title>${esc(inv.number)}</title><style>body{font:14px system-ui;max-width:760px;margin:30px auto;padding:0 20px;color:#111}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}td:nth-child(n+2),th:nth-child(n+2){text-align:right}h1{color:#e51937;margin:0}.r{text-align:right}</style>
   <h1>Redeye Digital Solutions</h1><p>TAX INVOICE</p><p><b>${esc(inv.number)}</b><br>Issued: ${esc(inv.issue_date)} · Due: ${esc(inv.due_date || '-')}<br>Status: ${esc(inv.status)}</p><p><b>Bill to:</b><br>${esc(client)}</p>
   <table><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>${items.map((i) => `<tr><td>${esc(i.desc)}</td><td>${esc(i.qty)}</td><td>${money2(i.rate)}</td><td>${money2(i.qty * i.rate)}</td></tr>`).join('')}</table>
   <p class="r">Subtotal: ${money2(inv.subtotal)}<br>Tax (${esc(inv.tax_percent)}%): ${money2(inv.total - inv.subtotal)}<br><b style="font-size:18px">Total: ${money2(inv.total)}</b></p><p>${esc(inv.notes || '')}</p>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
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
  if ($('#pe')) $('#pe').onclick = enablePush;
  if ($('#pt')) $('#pt').onclick = async () => { await api('/push/test', { method: 'POST' }); toast('Test sent'); };
  if ($('#inst')) $('#inst').onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; route(); };
  $('#pw').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('/me/password', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); ev.target.reset(); $('#pe2').textContent = ''; toast('Password updated'); }
    catch (err) { $('#pe2').textContent = err.message; }
  };
}
async function enablePush() {
  try {
    if ((await Notification.requestPermission()) !== 'granted') return toast('Permission denied. Allow notifications in browser settings.');
    const reg = await navigator.serviceWorker.ready, { key } = await api('/push/key');
    const pad = '='.repeat((4 - (key.length % 4)) % 4), raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    toast('Notifications enabled on this device');
  } catch (err) { toast('Could not enable: ' + err.message); }
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
