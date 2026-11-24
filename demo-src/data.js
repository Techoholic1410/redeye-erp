// DEMO data layer: replaces web/data.js in the published /demo/ build.
// Everything is stored in this browser's localStorage — no server, no real accounts.
// Same api() contract as the real data layer, with the same role rules enforced client-side for testing the UI.
import { ENTITIES, NAV, NAV_GROUPS } from './entities.js';

export const configured = true;
const DB_KEY = 'redeye-demo-db-v1', SESSION_KEY = 'redeye-demo-session-v1';
const day = (n = 0) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const uid = (n) => `00000000-0000-4000-8000-00000000000${n}`;


// ---- demo CRM data (deterministic) ----
const ago = (n) => new Date(Date.now() - n * 864e5).toISOString();
function demoLeads() {
  const nm = ['Anita Rao', 'Ravi Kumar', 'Priya Nair', 'Karthik R', 'Meena S', 'Arjun D', 'Lakshmi P', 'Suresh B', 'Divya M', 'Vignesh T', 'Kavya L', 'Mohan K', 'Sneha R', 'Prakash V', 'Deepa N', 'Harish G', 'Nithya A', 'Gopal S', 'Revathi C', 'Senthil M', 'Aarthi J', 'Balaji P', 'Janani K', 'Murugan D', 'Pooja V', 'Dinesh R', 'Shalini T', 'Rajesh N', 'Uma S', 'Vijay A'];
  const biz = ['Rao Sweets', 'Ravi Gym', 'Green Leaf Organics', 'Sri Sakthi Jewellers', 'Meena Boutique', 'Arjun Motors', 'Lakshmi Silks', 'Suresh Hardware', 'Divya Salon', 'Vignesh Cafe', 'Kavya Bakery', 'Mohan Clinic', 'Sneha Dance Academy', 'Prakash Builders', 'Deepa Fashions', 'Harish Fitness', 'Nithya Kitchen', 'Gopal Electronics', 'Revathi Jewels', 'Senthil Agro', 'Aarthi Skin Care', 'Balaji Tutorials', 'Janani Florist', 'Murugan Textiles', 'Pooja Studio', 'Dinesh Auto Care', 'Shalini Foods', 'Rajesh Realty', 'Uma Catering', 'Vijay Cycles'];
  const src = ['Instagram', 'Instagram', 'Referral', 'Website', 'Cold outreach', 'Ad campaign', 'WhatsApp', 'Google Maps', 'Justdial', 'Walk-in', 'Instagram', 'Cold outreach'];
  const camp = ['Nov reels push', 'Festive 2026', 'Brand film offer', 'Always-on', 'Diwali ads'];
  const city = ['Coimbatore', 'Pollachi', 'Tiruppur', 'Erode', 'Salem', 'Chennai'];
  const stage = ['New', 'New', 'Contacted', 'Contacted', 'Replied', 'Meeting', 'Proposal', 'Won', 'Lost', 'Contacted', 'Won', 'New'];
  const own = [uid(1), uid(2), uid(2), uid(1), null], lost = ['Budget too high', 'No response', 'Went with a competitor', 'Not ready yet'];
  return nm.map((n, i) => {
    const st = stage[(i * 7 + 3) % stage.length], owner = own[i % own.length], open = !['Won', 'Lost'].includes(st);
    return { id: i + 1, name: n, company: biz[i], phone: '9840' + String(100000 + i * 7919).slice(-6), email: i % 3 === 0 ? n.split(' ')[0].toLowerCase() + '@example.com' : null, instagram: i % 2 === 0 ? '@' + biz[i].toLowerCase().replace(/[^a-z]/g, '') : null,
      city: city[i % city.length], source: src[(i * 5 + 1) % src.length], campaign: camp[i % camp.length], interest: ['Monthly reels package', 'Festive video ads', 'Brand film', 'Social media management'][i % 4], value: 10000 + ((i * 13) % 11) * 10000, stage: st, lost_reason: st === 'Lost' ? lost[i % lost.length] : null,
      owner_id: owner, next_followup: open ? [day(-3), day(0), day(1), day(4), null, day(9), day(-1)][i % 7] : null, last_contact: st === 'New' ? null : day(-((i * 3) % 14) - 1), tags: i % 4 === 0 ? 'priority' : null,
      notes: i % 5 === 0 ? 'Asked for pricing and samples' : null, created_by: uid(1), created_at: ago(i * 3 + (i % 4)) };
  });
}
function demoActivities() {
  const L = demoLeads(), out = []; let id = 1; const order = ['New', 'Contacted', 'Replied', 'Meeting', 'Proposal'];
  for (const l of L) {
    const t0 = new Date(l.created_at).getTime();
    out.push({ id: id++, lead_id: l.id, kind: 'Created', body: 'Source: ' + l.source, to_stage: 'New', created_by: uid(1), created_at: l.created_at });
    const target = ['Won', 'Lost'].includes(l.stage) ? 'Proposal' : l.stage, upto = order.indexOf(target);
    for (let k = 1; k <= upto; k++) out.push({ id: id++, lead_id: l.id, kind: 'Stage', body: `${order[k - 1]} → ${order[k]}`, from_stage: order[k - 1], to_stage: order[k], created_by: uid(2), created_at: new Date(t0 + k * (1 + (l.id % 3)) * 864e5).toISOString() });
    if (['Won', 'Lost'].includes(l.stage)) out.push({ id: id++, lead_id: l.id, kind: 'Stage', body: `Proposal → ${l.stage}`, from_stage: 'Proposal', to_stage: l.stage, created_by: uid(2), created_at: new Date(t0 + (upto + 2) * (1 + (l.id % 3)) * 864e5).toISOString() });
    if (upto >= 1) out.push({ id: id++, lead_id: l.id, kind: l.id % 2 ? 'Call' : 'WhatsApp', body: l.id % 2 ? 'Spoke briefly, wants samples' : 'Sent intro and portfolio', created_by: uid(2), created_at: new Date(t0 + 864e5).toISOString() });
  }
  return out;
}

function seed() {
  const items = (a) => JSON.stringify(a);
  return {
    seq: { clients: 4, leads: 40, lead_activities: 400, projects: 3, tasks: 6, invoices: 4, expenses: 4, employees: 4, leaves: 2, attendance: 1, tickets: 3, assets: 4, packages: 3, content_plans: 2, content_items: 20, shoots: 3, meetings: 3, freelancers: 4, quotes: 2, payments: 3, contracts: 2, equipment_log: 2, task_templates: 5, comments: 1, attachments: 1, payment_requests: 2 },
    users: [
      { id: uid(1), name: 'Asha Admin', email: 'admin@demo', role: 'admin', active: 'Yes' },
      { id: uid(2), name: 'Manoj Manager', email: 'manager@demo', role: 'manager', active: 'Yes' },
      { id: uid(3), name: 'Sana Staff', email: 'staff@demo', role: 'staff', active: 'Yes' },
    ],
    clients: [
      { id: 1, name: 'Acme Retail', contact_person: 'Priya Shah', email: 'priya@acme.example', phone: '98200 11111', gstin: '27AAAAA0000A1Z5', status: 'Active', address: '12, Park Street,\nMumbai – 400001', code: 'AR' },
      { id: 2, name: 'Bluewave Foods', contact_person: 'Rahul Mehta', email: 'rahul@bluewave.example', phone: '98200 22222', status: 'Active' },
      { id: 3, name: 'Nova Clinics', contact_person: 'Dr. Iyer', email: 'office@nova.example', phone: '98200 33333', status: 'Prospect' },
    ],
    leads: demoLeads(),
    lead_activities: demoActivities(),
    projects: [
      { id: 1, name: 'Acme website revamp', client_id: 1, status: 'Active', manager_id: uid(2), start_date: day(-20), due_date: day(30), budget: 250000 },
      { id: 2, name: 'Bluewave Meta ads Q4', client_id: 2, status: 'Active', manager_id: uid(2), due_date: day(14), budget: 120000 },
    ],
    tasks: [
      { id: 1, title: 'Design homepage', project_id: 1, assignee_id: uid(3), priority: 'High', status: 'To do', due_date: day(0) },
      { id: 2, title: 'Set up GA4 tracking', project_id: 1, assignee_id: uid(3), priority: 'Medium', status: 'In progress', due_date: day(2) },
      { id: 3, title: 'Write ad copy', project_id: 2, assignee_id: uid(2), priority: 'High', status: 'Review', due_date: day(1) },
      { id: 4, title: 'Monthly report', project_id: 2, assignee_id: uid(1), priority: 'Low', status: 'Done', due_date: day(-3) },
      { id: 5, title: 'Fix contact form', project_id: 1, assignee_id: uid(3), priority: 'Urgent', status: 'To do', due_date: day(-1) },
    ],
    invoices: [
      { id: 1, number: 'RD-INV-0001', client_id: 1, issue_date: day(-25), due_date: day(-5), items: items([{ desc: 'Website design', qty: 1, rate: 100000 }]), tax_percent: 18, status: 'Overdue', subtotal: 100000, total: 118000, amount_paid: 40000 },
      { id: 2, number: 'RD-INV-0002', client_id: 2, issue_date: day(-3), due_date: day(12), items: items([{ desc: 'Ad management (Nov)', qty: 1, rate: 60000 }]), tax_percent: 18, status: 'Paid', subtotal: 60000, total: 70800, amount_paid: 70800 },
      { id: 3, number: 'RD/2026/AR-01', client_id: 1, client_ref: 'Acme Retail – Social Media Branding', issue_date: day(-2), due_date: day(10), items: items([{ desc: 'Social Media Branding & Video Content Production', note: 'Second half of 12-video package — due on delivery of 6 videos', amount: 12500 }]), deductions: [{ label: 'Received — Inv. RD/2026/AR-00', amount: 0 }], tax_percent: 0, carry_forward: 0, videos_committed: 12, videos_delivered: 6, status: 'Sent', subtotal: 12500, total: 12500, notes: 'This invoice covers the second half of the 12-video package.\n6 of 12 videos have been delivered; the remaining 6 are in the pipeline.\nKindly process the payable amount at your earliest convenience.' },
    ],
    expenses: [
      { id: 1, date: day(-2), category: 'Software & tools', description: 'Figma seats', amount: 8400, status: 'Approved', created_by: uid(1) },
      { id: 2, date: day(-1), category: 'Travel', description: 'Client visit cab', amount: 1250, status: 'Pending', created_by: uid(3) },
      { id: 3, date: day(-9), category: 'Ad spend', description: 'Meta ads top-up', amount: 25000, status: 'Pending', created_by: uid(2) },
    ],
    employees: [
      { id: 1, name: 'Asha Admin', designation: 'Director', department: 'Management', join_date: day(-900), status: 'Active' },
      { id: 2, name: 'Manoj Manager', designation: 'Project Manager', department: 'Development', join_date: day(-500), status: 'Active' },
      { id: 3, name: 'Sana Staff', designation: 'Designer', department: 'Design', join_date: day(-200), status: 'Active' },
    ],
    leaves: [
      { id: 1, user_id: uid(3), type: 'Casual', from_date: day(5), to_date: day(6), reason: 'Family event', status: 'Pending' },
      { id: 2, user_id: uid(2), type: 'Sick', from_date: day(0), to_date: day(0), status: 'Approved' },
    ],
    attendance: [],
    tickets: [
      { id: 1, subject: 'Contact form not sending', client_id: 1, priority: 'High', status: 'Open', assignee_id: uid(3) },
      { id: 2, subject: 'Need new banner sizes', client_id: 2, priority: 'Low', status: 'In progress', assignee_id: uid(2) },
    ],
    assets: [
      { id: 1, name: 'MacBook Air M3', category: 'Laptop', serial: 'MBA-0042', assigned_to: uid(3), status: 'In use', purchase_date: day(-200), cost: 114900 },
      { id: 2, name: 'Dell 27" Monitor', category: 'Monitor', status: 'In stock', cost: 21500 },
    ],
    packages: [
      { id: 1, client_id: 1, name: 'Social growth — 12 videos', monthly_fee: 25000, tax_percent: 0, videos_per_month: 12, posts_per_month: 8, shoots_per_month: 2, billing_day: 1, start_date: day(-60), status: 'Active', inclusions: '12 reels / month\n8 static posts or carousels\n2 shoot days\nMonthly performance report' },
      { id: 2, client_id: 2, name: 'Festive campaign — 6 videos', monthly_fee: 15000, tax_percent: 0, videos_per_month: 6, posts_per_month: 4, shoots_per_month: 1, billing_day: 5, start_date: day(-20), status: 'Active' },
    ],
    content_plans: [
      { id: 1, client_id: 1, month: day().slice(0, 7), title: 'Festive launch push', status: 'Approved', objective: 'Drive footfall for the festive collection', themes: 'Product stories\nBehind the scenes\nCustomer love',
        cadence: [{ format: 'Reel', platform: 'Instagram', pillar: 'Product stories', days: ['Mon', 'Thu'] }, { format: 'Carousel', platform: 'Instagram + Facebook', pillar: 'Tips & education', days: ['Wed'] }, { format: 'Static post', platform: 'Instagram', pillar: 'Customer love', days: ['Sat'] }] },
      { id: 2, client_id: 2, month: day().slice(0, 7), title: 'Recipe series', status: 'Draft', objective: 'Grow YouTube Shorts audience', themes: 'Quick recipes\nChef tips', cadence: [{ format: 'YouTube Short', platform: 'YouTube', pillar: 'Quick recipes', days: ['Tue', 'Fri'] }] },
    ],
    shoots: [
      { id: 1, title: 'Acme — festive product shoot', client_id: 1, shoot_date: day(2), call_time: '09:00', wrap_time: '15:00', location: 'Acme store, 12 Park Street', status: 'Confirmed', director_id: uid(2), crew_ids: [uid(3)], equipment_ids: [1], talent: 'Store staff x2', props: 'Festive collection, backdrop', shot_list: '1. Hero product turns\n2. Store walkthrough\n3. Staff testimonials' },
      { id: 2, title: 'Bluewave — recipe batch', client_id: 2, shoot_date: day(6), call_time: '10:30', location: 'Bluewave kitchen', status: 'Planned', director_id: uid(2), crew_ids: [], equipment_ids: [] },
      { id: 3, title: 'Acme — behind the scenes', client_id: 1, shoot_date: day(-5), call_time: '11:00', location: 'Acme warehouse', status: 'Completed', director_id: uid(2), crew_ids: [uid(3)], equipment_ids: [] },
    ],
    content_items: [
      { id: 1, plan_id: 1, client_id: 1, title: 'Festive collection teaser', pillar: 'Product stories', format: 'Reel', platform: 'Instagram', publish_date: day(-4), status: 'Published', owner_id: uid(2), editor_id: uid(3), client_status: 'Approved', posted_on: day(-4), views: 12400, reach: 9800, likes: 860, comments: 41, shares: 77, saves: 120 },
      { id: 2, plan_id: 1, client_id: 1, title: '5 ways to style a festive outfit', pillar: 'Tips & education', format: 'Carousel', platform: 'Instagram + Facebook', publish_date: day(-1), status: 'Published', owner_id: uid(2), designer_id: uid(3), client_status: 'Approved', posted_on: day(-1), views: 5200, reach: 4100, likes: 410, comments: 18, shares: 33, saves: 95 },
      { id: 3, plan_id: 1, client_id: 1, title: 'Behind the scenes at the warehouse', pillar: 'Behind the scenes', format: 'Reel', platform: 'Instagram', publish_date: day(1), status: 'Client review', owner_id: uid(2), editor_id: uid(3), client_status: 'Sent to client', shoot_id: 3 },
      { id: 4, plan_id: 1, client_id: 1, title: 'Store walkthrough', pillar: 'Product stories', format: 'Reel', platform: 'Instagram', publish_date: day(4), status: 'Shoot scheduled', owner_id: uid(2), writer_id: uid(2), editor_id: uid(3), shoot_id: 1, edit_due: day(3) },
      { id: 5, plan_id: 1, client_id: 1, title: 'Customer love — testimonial 1', pillar: 'Customer love', format: 'Static post', platform: 'Instagram', publish_date: day(5), status: 'Scripting', owner_id: uid(2), designer_id: uid(3) },
      { id: 6, plan_id: 1, client_id: 1, title: 'Festive offer explainer', pillar: 'Product stories', format: 'Reel', platform: 'Instagram', publish_date: day(8), status: 'Idea', owner_id: uid(2) },
      { id: 7, plan_id: 1, client_id: 1, title: 'Gift guide carousel', pillar: 'Tips & education', format: 'Carousel', platform: 'Instagram + Facebook', publish_date: day(10), status: 'Idea', owner_id: uid(2) },
      { id: 8, plan_id: 2, client_id: 2, title: '10-minute pasta', pillar: 'Quick recipes', format: 'YouTube Short', platform: 'YouTube', publish_date: day(3), status: 'Ready to shoot', owner_id: uid(2), writer_id: uid(2) },
      { id: 9, plan_id: 2, client_id: 2, title: 'Chef tip: knife basics', pillar: 'Chef tips', format: 'YouTube Short', platform: 'YouTube', publish_date: day(7), status: 'Idea', owner_id: uid(2) },
      { id: 11, client_id: 1, title: 'Product reveal reel', pillar: 'Product stories', format: 'Reel', platform: 'Instagram', publish_date: day(-12), status: 'Published', posted_on: day(-12), views: 18200, reach: 14000, likes: 1300, comments: 60, shares: 120, saves: 210 },
      { id: 12, client_id: 1, title: 'Behind the seams', pillar: 'Behind the scenes', format: 'Reel', platform: 'Instagram', publish_date: day(-19), status: 'Published', posted_on: day(-19), views: 9400, reach: 7000, likes: 640, comments: 22, shares: 40, saves: 80 },
      { id: 13, client_id: 1, title: 'Gift guide', pillar: 'Tips & education', format: 'Carousel', platform: 'Instagram', publish_date: day(-25), status: 'Published', posted_on: day(-25), views: 3100, reach: 2500, likes: 210, comments: 9, shares: 14, saves: 60 },
      { id: 14, client_id: 2, title: 'Pasta in 10 minutes', pillar: 'Quick recipes', format: 'YouTube Short', platform: 'YouTube', publish_date: day(-8), status: 'Published', posted_on: day(-8), views: 22800, reach: 18000, likes: 1500, comments: 88, shares: 140, saves: 0 },
      { id: 15, client_id: 2, title: 'Chef tip: salt', pillar: 'Chef tips', format: 'Static post', platform: 'Instagram', publish_date: day(-33), status: 'Published', posted_on: day(-33), views: 1900, reach: 1500, likes: 120, comments: 4, shares: 6, saves: 20 },
      { id: 16, client_id: 2, title: 'Kitchen tour', pillar: 'Behind the scenes', format: 'Reel', platform: 'Instagram', publish_date: day(-40), status: 'Published', posted_on: day(-40), views: 7700, reach: 6000, likes: 500, comments: 18, shares: 33, saves: 45 },
      { id: 10, plan_id: 1, client_id: 1, title: 'Diwali countdown stories', pillar: 'Product stories', format: 'Story', platform: 'Instagram', publish_date: day(0), status: 'Editing', owner_id: uid(2), editor_id: uid(3), edit_due: day(0) },
    ],
    meetings: [
      { id: 1, title: 'Acme monthly review', client_id: 1, kind: 'Monthly review', meeting_date: day(3), meeting_time: '16:00', location: 'Google Meet', attendees: 'Priya Shah, Manoj', status: 'Scheduled', agenda: 'Last month results\nNext month plan' },
      { id: 2, title: 'Bluewave kickoff', client_id: 2, kind: 'Kickoff', meeting_date: day(-8), meeting_time: '11:00', status: 'Done', minutes: 'Agreed 6-video package.', action_items: 'Share brand kit\nSchedule first shoot' },
    ],
    freelancers: [
      { id: 1, name: 'Karthik R', role: 'Videographer', phone: '98400 11111', city: 'Coimbatore', rate: 6000, rate_unit: 'Day', status: 'Available' },
      { id: 2, name: 'Divya S', role: 'Model / talent', phone: '98400 22222', city: 'Pollachi', rate: 3500, rate_unit: 'Day', status: 'Available' },
      { id: 3, name: 'Studio 9', role: 'Studio', city: 'Coimbatore', rate: 2500, rate_unit: 'Hour', status: 'Available' },
    ],
    quotes: [
      { id: 1, number: 'RD/Q/2026-001', client_id: 3, title: 'Clinic brand film + 8 reels', issue_date: day(-3), valid_until: day(11), items: items([{ desc: 'Brand film (2 min)', note: 'Script, shoot, edit', amount: 40000 }, { desc: '8 social reels', amount: 32000 }]), tax_percent: 0, subtotal: 72000, total: 72000, status: 'Sent', notes: '50% advance to start\nBalance on delivery' },
    ],
    payments: [
      { id: 1, invoice_id: 2, amount: 70800, paid_on: day(-2), method: 'UPI', reference: 'UPI-48213', created_by: uid(1) },
      { id: 2, invoice_id: 1, amount: 40000, paid_on: day(-6), method: 'Bank transfer', reference: 'NEFT-99120', created_by: uid(1) },
    ],
    contracts: [
      { id: 1, client_id: 3, title: 'Nova Clinics — content services agreement', status: 'Sent', body: 'SERVICE AGREEMENT\n\n1. Scope: 8 reels and 4 posts per month.\n2. Fees: ₹30,000 per month, invoiced on the 1st.\n3. Approvals: Client reviews within 2 working days.\n\n(Demo contract)', created_by: uid(1) },
    ],
    equipment_log: [
      { id: 1, asset_id: 2, user_id: uid(3), out_date: day(-3), due_back: day(-1), returned_on: null, condition_out: 'Good', created_by: uid(3) },
    ],
    task_templates: [
      { id: 1, name: 'Client onboarding', description: 'Steps after a new client signs', items: [{ title: 'Sign agreement & collect advance', days: 2, priority: 'High' }, { title: 'Collect brand assets, logos & guidelines', days: 3, priority: 'High' }, { title: 'Kickoff meeting with client', days: 5, priority: 'Medium' }, { title: 'Create month-1 content plan', days: 7, priority: 'High' }] },
      { id: 2, name: 'Shoot day checklist', description: 'Dates relative to the shoot date', items: [{ title: 'Confirm location & permissions', days: -3, priority: 'High' }, { title: 'Charge batteries, format cards, pack kit', days: -1, priority: 'Medium' }, { title: 'Share call sheet with crew and client', days: -1, priority: 'Medium' }, { title: 'Share footage with editor', days: 1, priority: 'High' }] },
      { id: 3, name: 'Monthly content cycle', description: 'Repeat every month for a retainer client', items: [{ title: 'Draft content plan for the month', days: 1, priority: 'High' }, { title: 'Client approval of the plan', days: 4, priority: 'High' }, { title: 'Send monthly report to client', days: 28, priority: 'Medium' }] },
      { id: 4, name: 'Month-end close', description: 'Money housekeeping', items: [{ title: 'Follow up unpaid invoices', days: 1, priority: 'High' }, { title: 'Pay freelancers', days: 3, priority: 'High' }] },
    ],
    comments: [],
    attachments: [],
    payment_requests: [
      { id: 1, client_id: 1, invoice_id: 1, amount: 48000, purpose: 'Invoice RD-INV-0001 balance', due_date: day(2), status: 'Open', created_by: uid(1) },
    ],
    notifications: [
      { id: 1, user_id: uid(1), title: 'Leave request', body: 'Sana Staff: Casual', url: '#/leaves', read: false, created_at: now() },
      { id: 2, user_id: uid(3), title: 'New task assigned', body: 'Fix contact form', url: '#/tasks', read: false, created_at: now() },
    ],
  };
}
let db;
try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch {}
if (!db) db = seed();
else { const fresh = seed(); for (const k of Object.keys(fresh)) if (!db[k]) db[k] = fresh[k]; db.seq = { ...fresh.seq, ...db.seq }; }
for (const [k, f] of [['invoices', 'share_token'], ['quotes', 'share_token'], ['content_items', 'share_token'], ['content_plans', 'share_token'], ['contracts', 'share_token'], ['payment_requests', 'share_token'], ['clients', 'portal_token']])
  (db[k] || []).forEach((r) => { if (!r[f]) r[f] = crypto.randomUUID(); });
(db.invoices || []).forEach((r) => { if (r.amount_paid == null) r.amount_paid = 0; });
const save = () => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {} };
save();   // persist seed data (incl. share tokens) so links stay stable between page loads
export const resetDemo = () => { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); location.reload(); };
window.resetDemo = resetDemo;

const listeners = [];
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
export const sb = {
  auth: {
    getSession: async () => ({ data: { session: session ? {} : null } }),
    onAuthStateChange: (cb) => { listeners.push(cb); },
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel() {},
};

const table = (k) => (k === 'users' ? 'users' : k);
const me = () => { if (!session) throw new Error('Not signed in'); return db.users.find((u) => u.id === session.id); };
const notify = (ids, title, body, url = '#/') => {
  for (const user_id of new Set(ids.filter(Boolean))) db.notifications.unshift({ id: Date.now() + Math.random(), user_id, title, body, url, read: false, created_at: now() });
};
const byRole = (...roles) => db.users.filter((u) => roles.includes(u.role) && u.active === 'Yes').map((u) => u.id);
const csvEsc = (v) => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
const can = (key, perm) => { if (!ENTITIES[key].perms[perm].includes(me().role)) throw new Error('Not allowed'); };

function payload(key, body, isNew) {
  const o = {};
  for (const f of ENTITIES[key].fields) {
    if (f.virtual || f.auto || f.ro || !(f.k in body)) continue;
    let v = body[f.k];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      if (f.t === 'number' || f.t === 'money') { v = Number(v); if (!Number.isFinite(v)) throw new Error(`${f.l} must be a number`); }
      else if (f.t === 'ref' && f.to !== 'users') v = Number(v);
      else if (f.t === 'items') v = typeof v === 'string' ? v : JSON.stringify(v);
      else if (f.t === 'deductions' || f.t === 'multi' || f.t === 'cadence') v = typeof v === 'string' ? JSON.parse(v) : v;
    }
    if (f.req && v === null) throw new Error(`${f.l} is required`);
    if (isNew && v === null) continue;
    o[f.k] = v;
  }
  return o;
}
function businessRules(key, row, old) {
  const u = me();
  if ((key === 'invoices' || key === 'quotes') && !row.share_token) row.share_token = old?.share_token || crypto.randomUUID();
  if (key === 'invoices') {
    let items = []; try { items = JSON.parse(row.items || '[]'); } catch {}
    row.subtotal = items.reduce((s, i) => s + (i.amount != null ? +i.amount || 0 : (+i.qty || 0) * (+i.rate || 0)), 0);
    const less = (row.deductions || []).reduce((s, d) => s + (+d.amount || 0), 0);
    row.total = Math.round((row.subtotal * (1 + (+row.tax_percent || 0) / 100) - less - (+row.carry_forward || 0)) * 100) / 100;
    if (!String(row.number || '').trim()) {
      if (old && old.number) row.number = old.number;
      else {
        const code = String((db.clients.find((c) => String(c.id) === String(row.client_id)) || {}).code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (code) { const pfx = `RD/${String(row.issue_date || day()).slice(0, 4)}/${code}-`; const n = db.invoices.filter((i) => String(i.number || '').startsWith(pfx)).length + 1; row.number = pfx + String(n).padStart(2, '0'); }
        else row.number = `RD-INV-${String(db.seq.invoices).padStart(4, '0')}`;
      }
    }
    if (row.status === 'Paid' && old?.status !== 'Paid') notify(byRole('admin', 'manager'), 'Invoice paid', `${row.number} — ${row.total}`, '#/invoices');
  }
  if (key === 'tasks' && row.assignee_id && row.assignee_id !== old?.assignee_id && row.assignee_id !== u.id) notify([row.assignee_id], 'New task assigned', row.title, '#/tasks');
  if (key === 'leaves') {
    if (u.role === 'staff') { row.user_id = u.id; if (!old) row.status = 'Pending'; } else if (!row.user_id) row.user_id = u.id;
    if (!old) notify(byRole('admin', 'manager').filter((i) => i !== u.id), 'Leave request', `${db.users.find((x) => x.id === row.user_id)?.name}: ${row.type}`, '#/leaves');
    else if (row.status !== old.status) notify([row.user_id], `Leave ${String(row.status).toLowerCase()}`, row.type, '#/leaves');
  }
  if (key === 'expenses') {
    if (u.role === 'staff' && !old) row.status = 'Pending';
    if (!old) notify(byRole('admin', 'manager').filter((i) => i !== u.id), 'Expense submitted', `${row.description} (${row.amount})`, '#/expenses');
    else if (row.status !== old.status) notify([old.created_by], `Expense ${String(row.status).toLowerCase()}`, row.description, '#/expenses');
  }
  if (key === 'quotes') {
    let it = []; try { it = JSON.parse(row.items || '[]'); } catch {}
    row.subtotal = it.reduce((a, i) => a + (+i.amount || 0), 0); row.total = Math.round(row.subtotal * (1 + (+row.tax_percent || 0) / 100) * 100) / 100;
    if (!String(row.number || '').trim()) row.number = old?.number || `RD/Q/${String(row.issue_date || day()).slice(0, 4)}-${String((db.quotes.length || 0) + 1).padStart(3, '0')}`;
    if (row.status === 'Accepted' && old?.status !== 'Accepted') notify(byRole('admin', 'manager').filter((i) => i !== u.id), '🎉 Quote accepted', `${row.number} — ${row.total}`, '#/quotes');
  }
  if (key === 'content_items') {
    for (const [f, t] of [['writer_id', 'Script assigned to you'], ['editor_id', 'Edit assigned to you'], ['designer_id', 'Design assigned to you'], ['owner_id', 'Content assigned to you']])
      if (row[f] && row[f] !== u.id && row[f] !== old?.[f]) notify([row[f]], t, row.title, '#/content_items');
    if (old && row.status !== old.status) {
      if (row.status === 'Shot') notify([row.editor_id].filter((i) => i !== u.id), 'Footage ready to edit', row.title, '#/content_items');
      if (row.status === 'Internal review') notify([...byRole('admin', 'manager'), row.owner_id].filter((i) => i !== u.id), 'Ready for internal review', row.title, '#/content_items');
      if (row.status === 'Changes needed') notify([row.editor_id, row.designer_id, row.writer_id, row.owner_id].filter((i) => i !== u.id), 'Changes requested', row.title, '#/content_items');
      if (row.status === 'Approved') notify([row.owner_id, row.editor_id, row.designer_id].filter((i) => i !== u.id), 'Approved — ready to schedule', row.title, '#/content_items');
    }
  }
  if (key === 'shoots') {
    const crew = [...(row.crew_ids || []), row.director_id].filter((i) => i && i !== u.id);
    if (!old) notify(crew, 'Shoot scheduled', `${row.title} — ${row.shoot_date || 'date TBC'}${row.call_time ? ' at ' + row.call_time : ''}`, '#/shoots');
    else if (row.shoot_date !== old.shoot_date || row.call_time !== old.call_time || row.location !== old.location) notify(crew, 'Shoot updated', `${row.title} — ${row.shoot_date}`, '#/shoots');
  }
  if (key === 'content_plans' && old && row.status !== old.status && ['Pending approval', 'Approved'].includes(row.status)) notify(byRole('admin', 'manager').filter((i) => i !== u.id), 'Content plan ' + row.status.toLowerCase(), row.title, '#/content_plans');
  if (key === 'tickets' && !old) notify(byRole('admin', 'manager').filter((i) => i !== u.id), 'New support ticket', row.subject, '#/tickets');
  if (key === 'leads' && old && row.stage !== old.stage) { db.seq.lead_activities++; db.lead_activities.push({ id: db.seq.lead_activities, lead_id: row.id, kind: 'Stage', body: `${old.stage} → ${row.stage}${row.lost_reason ? ' (' + row.lost_reason + ')' : ''}`, from_stage: old.stage, to_stage: row.stage, created_by: u.id, created_at: now() }); }
  if (key === 'leads' && row.stage === 'Won' && old?.stage !== 'Won') notify(byRole('admin', 'manager'), '🎉 Lead won', row.name, '#/leads');
}
function syncInvoice(id) {
  const inv = db.invoices.find((i) => String(i.id) === String(id)); if (!inv) return;
  const paid = db.payments.filter((p) => String(p.invoice_id) === String(id)).reduce((a, p) => a + (+p.amount || 0), 0);
  inv.amount_paid = paid;
  if (inv.status === 'Cancelled') return;
  if (inv.total > 0 && paid >= inv.total) inv.status = 'Paid';
  else if (paid > 0) inv.status = ['Paid', 'Draft', 'Sent'].includes(inv.status) ? 'Partial' : inv.status;
  else if (['Paid', 'Partial'].includes(inv.status)) inv.status = 'Sent';
}
function afterWrite(key, row) {
  if (key === 'payments') { syncInvoice(row.invoice_id); notify(byRole('admin', 'manager').filter((i) => i !== me().id), '💰 Payment received', `${db.invoices.find((i) => String(i.id) === String(row.invoice_id))?.number} — ${row.amount}`, '#/payments'); }
  if (key === 'equipment_log') { const a = db.assets.find((x) => String(x.id) === String(row.asset_id)); if (a) { a.status = row.returned_on ? 'In stock' : 'In use'; a.assigned_to = row.returned_on ? null : row.user_id; } }
}
const own = (key) => ENTITIES[key].ownCol;
const visible = (key, rows) => (me().role === 'staff' && own(key) ? rows.filter((r) => r[own(key)] === me().id) : rows);

export async function api(path, opts = {}) {
  const method = opts.method || 'GET', body = opts.body || {};
  await new Promise((r) => setTimeout(r, 60));   // feel like a network call
  let m;
  if (path === '/login') {
    const email = String(body.email || '').trim().toLowerCase();
    const role = email.startsWith('manager') ? 'manager' : email.startsWith('staff') ? 'staff' : 'admin';
    const u = db.users.find((x) => x.role === role);
    session = { id: u.id }; localStorage.setItem(SESSION_KEY, JSON.stringify(session)); return {};
  }
  if (path === '/public/doc') { const t = body.kind === 'quote' ? db.quotes : db.invoices, d = t.find((x) => x.share_token === body.token); if (!d) return null; return { doc: d, client: db.clients.find((c) => String(c.id) === String(d.client_id)) || null, company: await api('/company') }; }
  if (path === '/logout') { session = null; localStorage.removeItem(SESSION_KEY); return {}; }
  if (path === '/meta') {
    const user = me(), entities = {};
    for (const k of NAV) {
      const e = ENTITIES[k]; if (!e.perms.read.includes(user.role)) continue;
      entities[k] = { label: e.label, icon: e.icon, labelField: e.labelField, board: e.board, cols: e.cols, fields: e.fields,
        calendar: e.calendar, filters: e.filters, actions: e.actions, defaultMode: e.defaultMode, import: e.import, bulk: e.bulk,
        can: Object.fromEntries(['create', 'update', 'del'].map((p) => [p, e.perms[p].includes(user.role)])) };
    }
    const groups = NAV_GROUPS.map(([g, ks]) => [g, ks.filter((k) => entities[k])]).filter(([, ks]) => ks.length);
    return { user, entities, groups };
  }
  if (path === '/me/password') { if (String(body.next || '').length < 8) throw new Error('New password must be at least 8 characters'); return {}; }
  if ((m = path.match(/^\/lookup\/(\w+)$/))) return db[m[1]].filter((x) => x.active !== 'No').map((x) => ({ id: x.id, label: x.name ?? x.title ?? x.number })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
  if ((m = path.match(/^\/e\/(\w+)\/export$/))) {
    can(m[1], 'read');
    const fields = ENTITIES[m[1]].fields.filter((f) => f.k && f.t !== 'items' && f.t !== 'deductions' && f.t !== 'multi' && f.t !== 'cadence' && !f.virtual);
    return [fields.map((f) => csvEsc(f.l)).join(','), ...visible(m[1], db[table(m[1])]).map((r) => fields.map((f) => csvEsc(r[f.k])).join(','))].join('\n');
  }
  if ((m = path.match(/^\/e\/(\w+)(?:\/([\w-]+))?(?:\?(.*))?$/))) {
    const key = m[1], id = m[2], e = ENTITIES[key], t = table(key);
    if (!e) throw new Error('Unknown module');
    if (method === 'GET') {
      can(key, 'read');
      const q = (new URLSearchParams(m[3] || '').get('q') || '').toLowerCase();
      let rows = visible(key, db[t]);
      if (q) rows = rows.filter((r) => e.fields.some((f) => ['text', 'textarea', 'email', 'tel', 'select'].includes(f.t) && String(r[f.k] ?? '').toLowerCase().includes(q)));
      return [...rows].sort((a, b) => (key === 'users' ? a.name.localeCompare(b.name) : b.id - a.id)).map((r) => ({ ...r }));
    }
    if (method === 'POST') {
      can(key, 'create');
      const row = payload(key, body, true);
      if (key === 'users') {
        if (!body.password || body.password.length < 8) throw new Error('Password must be at least 8 characters');
        if (db.users.some((u) => u.email === String(row.email).toLowerCase())) throw new Error('That already exists');
        const u = { id: crypto.randomUUID(), ...row, email: String(row.email).toLowerCase() }; db.users.push(u); save(); return u;
      }
      db.seq[key] = (db.seq[key] || 0) + 1;
      const defaults = Object.fromEntries(e.fields.filter((f) => f.def !== undefined && f.def !== 'today').map((f) => [f.k, f.def]));
      const out = { id: db.seq[key], created_by: me().id, created_at: now(), ...defaults, ...row };
      for (const f of e.fields) if (f.def === 'today' && out[f.k] == null) out[f.k] = day();
      if (key === 'invoices') { out.status = out.status || 'Draft'; out.amount_paid = 0; }
      if (['invoices', 'quotes', 'content_items', 'content_plans', 'contracts', 'payment_requests'].includes(key)) out.share_token = crypto.randomUUID();
      if (key === 'clients') out.portal_token = crypto.randomUUID();
      businessRules(key, out, null);
      db[t].push(out); afterWrite(key, out); save(); return out;
    }
    if (method === 'PUT') {
      can(key, 'update');
      const old = db[t].find((r) => String(r.id) === String(id)); if (!old) throw new Error('Not allowed');
      if (key === 'users' && old.id === me().id && ((body.role && body.role !== 'admin') || body.active === 'No')) throw new Error("You can't demote or deactivate yourself");
      const row = payload(key, body, false), out = { ...old, ...row };
      if (key !== 'users') businessRules(key, out, old);
      if (key === 'contracts' && old.status === 'Signed') throw new Error('A signed contract cannot be edited. Create a new one instead.');
      db[t][db[t].indexOf(old)] = out; afterWrite(key, out); save(); return out;
    }
    if (method === 'DELETE') {
      can(key, 'del');
      if (key === 'users' && id === me().id) throw new Error("You can't delete yourself");
      if (key === 'clients' && (db.invoices.some((i) => String(i.client_id) === String(id)))) throw new Error('This record is used elsewhere, so it can’t be deleted');
      const i = db[t].findIndex((r) => String(r.id) === String(id)); if (i < 0) throw new Error('Not allowed');
      const gone = db[t].splice(i, 1)[0]; if (key === 'payments') syncInvoice(gone.invoice_id); save(); return {};
    }
  }
  if (path === '/calendar/token') { db.calToken ||= crypto.randomUUID(); save(); return db.calToken; }
  if (path === '/public/approval') {
    let items = [], plan = null, client = null;
    if (body.kind === 'item') { const it = db.content_items.find((x) => x.share_token === body.token); if (it) { items = [it]; client = db.clients.find((c) => c.id === it.client_id); } }
    else { const p = db.content_plans.find((x) => x.share_token === body.token); if (p) { plan = { title: p.title, month: p.month, objective: p.objective }; items = db.content_items.filter((x) => x.plan_id === p.id); client = db.clients.find((c) => c.id === p.client_id); } }
    if (!client) return null;
    return { kind: body.kind, client: { name: client.name }, company: { name: 'Redeye Digital Solutions' }, plan, items: items.map(({ id, title, format, platform, pillar, publish_date, publish_time, concept, script, caption, hashtags, asset_link, status, client_status, client_feedback }) => ({ id, title, format, platform, pillar, publish_date, publish_time, concept, script, caption, hashtags, asset_link, status, client_status, client_feedback })) };
  }
  if (path === '/public/respond') {
    const it = db.content_items.find((x) => x.id === body.item_id); if (!it) throw new Error('This link is not valid');
    if (body.decision === 'changes' && !String(body.comment || '').trim()) throw new Error('Please tell us what to change');
    it.client_status = body.decision === 'approve' ? 'Approved' : 'Changes requested';
    if (body.decision === 'approve' && ['Client review', 'Changes needed', 'Internal review'].includes(it.status)) it.status = 'Approved';
    if (body.decision === 'changes' && ['Client review', 'Approved', 'Scheduled'].includes(it.status)) it.status = 'Changes needed';
    if (String(body.comment || '').trim()) it.client_feedback = (it.client_feedback ? it.client_feedback + '\n' : '') + `[${body.who || 'Client'}] ${body.comment}`;
    notify(byRole('admin', 'manager'), body.decision === 'approve' ? '✅ Client approved' : '✏️ Client wants changes', it.title, '#/content_items'); save(); return { ok: true, status: it.status };
  }
  if (path === '/public/portal') {
    const c = db.clients.find((x) => x.portal_token === body.token); if (!c) return null;
    return { client: { name: c.name }, company: { name: 'Redeye Digital Solutions', email: 'info@redeyedigital.in', phone: '7708037165', tagline: 'Content that catches the eye.' },
      upcoming: db.content_items.filter((i) => i.client_id === c.id && i.status !== 'Published').map((i) => ({ id: i.id, title: i.title, format: i.format, platform: i.platform, publish_date: i.publish_date, status: i.status, client_status: i.client_status, share_token: i.share_token })),
      published: db.content_items.filter((i) => i.client_id === c.id && i.status === 'Published').map((i) => ({ title: i.title, format: i.format, platform: i.platform, date: i.posted_on || i.publish_date, url: i.posted_url, views: i.views, reach: i.reach, likes: i.likes, comments: i.comments, shares: i.shares })),
      invoices: db.invoices.filter((i) => i.client_id === c.id && !['Draft', 'Cancelled'].includes(i.status)).map((i) => ({ number: i.number, issue_date: i.issue_date, due_date: i.due_date, total: i.total, amount_paid: i.amount_paid, status: i.status, share_token: i.share_token })),
      shoots: db.shoots.filter((s2) => s2.client_id === c.id && s2.shoot_date >= day() && s2.status !== 'Cancelled').map((s2) => ({ title: s2.title, date: s2.shoot_date, call_time: s2.call_time, location: s2.location, status: s2.status })),
      package: (db.packages.find((p) => p.client_id === c.id && p.status === 'Active') ? (({ name, videos_per_month, posts_per_month }) => ({ name, videos: videos_per_month, posts: posts_per_month }))(db.packages.find((p) => p.client_id === c.id && p.status === 'Active')) : null) };
  }
  if ((m = path.match(/^\/import\/(\w+)$/)) && method === 'POST') {
    const key = m[1]; if (!ENTITIES[key]?.import) throw new Error('Import is not available for this module');
    for (const r of body.rows || []) { db.seq[key] = (db.seq[key] || 0) + 1; db[table(key)].push({ id: db.seq[key], created_by: me().id, created_at: now(), ...payload(key, r, true) }); }
    save(); return { count: (body.rows || []).length };
  }
  if (path === '/activities') {
    if (method === 'POST') { db.seq.lead_activities++; const a = { id: db.seq.lead_activities, lead_id: body.lead_id, kind: body.kind, body: body.body || null, created_by: me().id, created_at: now() }; db.lead_activities.push(a); save(); return a; }
    const rows = body.lead_id ? db.lead_activities.filter((x) => String(x.lead_id) === String(body.lead_id)) : db.lead_activities;
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  if (path === '/tasks/remind') {
    const t = db.tasks.find((x) => String(x.id) === String(body.id)); if (!t) throw new Error('Task not found'); if (!t.assignee_id) throw new Error('This task has no assignee yet');
    notify([t.assignee_id], '🔔 ' + me().name + ' reminded you', t.title + (body.note ? ' — ' + body.note : ''), '#/tasks'); save(); return {};
  }
  if (path === '/tasks/snooze') {
    const t = db.tasks.find((x) => String(x.id) === String(body.id)); if (!t || t.assignee_id !== me().id) throw new Error('Only the person assigned can snooze this reminder');
    t.remind_at = new Date(Date.now() + body.mins * 60000).toISOString(); save(); return {};
  }
  if (path === '/public/payreq') {
    const r = db.payment_requests.find((x) => x.share_token === body.token); if (!r) return null;
    return { request: { amount: r.amount, purpose: r.purpose, due_date: r.due_date, status: r.status, claimed_ref: r.claimed_ref }, client: { name: db.clients.find((c) => c.id === r.client_id)?.name }, invoice: { number: db.invoices.find((i) => i.id === r.invoice_id)?.number },
      company: { name: 'Redeye Digital Solutions', upi_id: 'redeye@upi', bank: { holder: 'Demo Account Holder', bank: 'Demo Bank', branch: 'Demo Branch', account: '0000000000000', ifsc: 'DEMO0000000' }, email: 'info@redeyedigital.in', phone: '7708037165' } };
  }
  if (path === '/public/claim') {
    const r = db.payment_requests.find((x) => x.share_token === body.token); if (!r) throw new Error('This link is not valid');
    if (['Paid', 'Cancelled'].includes(r.status)) throw new Error('This request is already ' + r.status.toLowerCase());
    if (String(body.ref || '').trim().length < 4) throw new Error('Please enter the UPI / bank reference number');
    r.status = 'Paid claimed'; r.claimed_ref = body.ref.trim(); notify(byRole('admin', 'manager'), '💸 Client says paid', `${r.amount} (ref ${r.claimed_ref})`, '#/payment_requests'); save(); return { ok: true };
  }
  if (path === '/public/contract') {
    const k = db.contracts.find((x) => x.share_token === body.token); if (!k) return null;
    return { contract: { title: k.title, body: k.body, status: k.status, signed_name: k.signed_name, signed_at: k.signed_at }, client: { name: db.clients.find((c) => c.id === k.client_id)?.name }, company: { name: 'Redeye Digital Solutions' } };
  }
  if (path === '/public/sign') {
    const k = db.contracts.find((x) => x.share_token === body.token); if (!k) throw new Error('This link is not valid');
    if (k.status === 'Signed') throw new Error('Already signed'); if (String(body.who || '').trim().length < 3) throw new Error('Please type your full name');
    k.status = 'Signed'; k.signed_name = body.who.trim(); k.signed_at = now(); notify(byRole('admin', 'manager'), '✍️ Contract signed', k.title, '#/contracts'); save(); return { ok: true };
  }
  if (path === '/comments' && method === 'POST') { db.seq.comments++; const c = { id: db.seq.comments, entity: body.entity, record_id: body.record_id, body: body.body, mentions: body.mentions || [], created_by: me().id, created_at: now() };
    db.comments.push(c); for (const u of (body.mentions || []).filter((x) => x !== me().id)) notify([u], 'You were mentioned by ' + me().name, String(body.body).slice(0, 120), '#/' + body.entity); save(); return c; }
  if (path === '/comments') return db.comments.filter((c) => c.entity === body.entity && String(c.record_id) === String(body.record_id));
  if ((m = path.match(/^\/comments\/(\d+)$/)) && method === 'DELETE') { db.comments = db.comments.filter((c) => String(c.id) !== m[1]); save(); return {}; }
  if (path === '/attachments' && method === 'POST') {
    const f = body.file; if (f.size > 300000) throw new Error('Demo accepts files up to 300 KB');
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    db.seq.attachments++; const a = { id: db.seq.attachments, entity: body.entity, record_id: body.record_id, name: f.name, path: data, size: f.size, mime: f.type, created_by: me().id, created_at: now() }; db.attachments.push(a); save(); return a;
  }
  if (path === '/attachments') return db.attachments.filter((a) => a.entity === body.entity && String(a.record_id) === String(body.record_id));
  if (path === '/attachments/url') return { url: body.path };
  if ((m = path.match(/^\/attachments\/(\d+)$/)) && method === 'DELETE') { db.attachments = db.attachments.filter((a) => String(a.id) !== m[1]); save(); return {}; }
  if (path === '/attendance/today') return db.attendance.find((a) => a.user_id === me().id && a.date === day()) || null;
  if (path === '/attendance/toggle') {
    const t = new Date().toTimeString().slice(0, 5); let a = db.attendance.find((x) => x.user_id === me().id && x.date === day());
    if (!a) { db.seq.attendance++; a = { id: db.seq.attendance, user_id: me().id, date: day(), check_in: t, check_out: null }; db.attendance.push(a); } else if (!a.check_out) a.check_out = t;
    save(); return a;
  }
  if (path === '/ai') {
    await new Promise((r) => setTimeout(r, 700));
    const t = body.task, it = body.item || {};
    if (t === 'script') return { text: `HOOK (0-3s): "${it.title || 'Your title'}" - open on the product in close-up.\n\n**Scene table**\n1. Visual: close-up reveal | VO: "Ever wondered why…" | Text: THE SECRET\n2. Visual: behind the scenes | VO: "Here's how we do it" | Text: 3 STEPS\n\nCTA: Visit us today.\nMusic: upbeat, local flavour. Duration ~25s.\n\n(Demo sample — the live app uses Claude.)` };
    if (t === 'caption') return { data: { caption: `${it.title || 'New post'} ✨\nHere's what makes it special. Tap to know more.`, hashtags: '#redeye #contentcreators #pollachi #reels' }, text: '' };
    if (t === 'ideas') return { data: (body.items || []).map((x, n) => ({ id: x.id, title: `Idea ${n + 1}: ${x.pillar || x.format}`, concept: 'Open with a surprising question, show the product in action, end with a clear call to action. (Demo sample)' })) };
    if (t === 'shotlist') return { text: '1. Wide establishing shot of the location\n2. Close-ups of the product\n3. Talent to camera, 3 takes\n(Demo sample)' };
    if (t === 'shoot_plan') { const by = {}; (body.items || []).forEach((x) => (by[x.client_id] ||= []).push(x)); return { data: Object.entries(by).map(([cid, xs], n) => ({ title: `${xs[0].client} - batch shoot`, client_id: +cid, date: day(3 + n * 3), call_time: '09:30', item_ids: xs.map((x) => x.id), reason: 'Batched by client, 3+ days ahead of first publish date. (Demo sample)' })) }; }
    return { text: 'This is a demo reply. In the live app, Claude answers here using your clients, plans and shoots.' };
  }
  if (path === '/company' && method === 'PUT') { db.company = { ...body }; save(); return db.company; }
  if (path === '/company' && db.company) return db.company;
  if (path === '/company') return { name: 'Redeye Digital Solutions', tagline: 'Content that catches the eye.', address: ['4/2A, Alamu Colony, Chinnampalayam,', 'Pollachi – 642003'], email: 'info@redeyedigital.in', phone: '7708037165', bank: { holder: 'Demo Account Holder', bank: 'Demo Bank', branch: 'Demo Branch', account: '0000000000000', ifsc: 'DEMO0000000' }, signatory: 'Authorized Signatory' };
  if (path === '/dashboard') {
    const r = me().role, mth = day().slice(0, 7), sum = (rows, k) => rows.reduce((s, x) => s + (+x[k] || 0), 0);
    const out = {
      myTasks: db.tasks.filter((x) => x.assignee_id === me().id && x.status !== 'Done').sort((a, b) => (a.due_date || '9') < (b.due_date || '9') ? -1 : 1).slice(0, 8),
      activeProjects: db.projects.filter((x) => x.status === 'Active').length,
      openTickets: db.tickets.filter((x) => !['Resolved', 'Closed'].includes(x.status)).length,
      openLeads: { n: db.leads.filter((x) => !['Won', 'Lost'].includes(x.stage)).length, v: sum(db.leads.filter((x) => !['Won', 'Lost'].includes(x.stage)), 'value') },
      onLeave: db.leaves.filter((x) => x.status === 'Approved' && x.from_date <= day() && day() <= x.to_date).map((x) => db.users.find((u) => u.id === x.user_id)?.name),
      pendingLeaves: r === 'staff' ? 0 : db.leaves.filter((x) => x.status === 'Pending').length,
    };
    if (r !== 'staff') {
      const out_ = db.invoices.filter((x) => ['Sent', 'Overdue', 'Partial'].includes(x.status)), od = db.invoices.filter((x) => x.status === 'Overdue' || (x.status === 'Partial' && x.due_date < day()));
      const bal = (rows) => rows.reduce((a, x) => a + ((+x.total || 0) - (+x.amount_paid || 0)), 0);
      const paid = (m_) => sum(db.payments.filter((x) => String(x.paid_on).startsWith(m_)), 'amount');
      const exp = (m_) => sum(db.expenses.filter((x) => ['Approved', 'Reimbursed'].includes(x.status) && String(x.date).startsWith(m_)), 'amount');
      Object.assign(out, { outstanding: { v: bal(out_), n: out_.length }, overdue: { v: bal(od), n: od.length }, revenueMonth: paid(mth), expenseMonth: exp(mth),
        pendingExpenses: db.expenses.filter((x) => x.status === 'Pending').length,
        trend: [5, 4, 3, 2, 1, 0].map((i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); const m_ = d.toISOString().slice(0, 7); return { m: m_, revenue: i === 0 ? paid(m_) : 18000 * (6 - i) + (i % 2) * 9000, expenses: i === 0 ? exp(m_) : 7000 + (i % 3) * 4000 }; }) });
    }
    return out;
  }
  if (path === '/notifications') {
    const items = db.notifications.filter((n) => n.user_id === me().id).slice(0, 40);
    return { items, unread: items.filter((n) => !n.read).length };
  }
  if (path === '/notifications/read') { db.notifications.forEach((n) => { if (n.user_id === me().id) n.read = true; }); save(); return {}; }
  if (path === '/push/key') return { key: '' };
  if (path === '/push/subscribe') throw new Error('Push is disabled in the demo (needs the real Supabase backend)');
  if (path === '/push/test') { notify([me().id], 'Redeye ERP', 'Notifications are working 🎉'); save(); return {}; }
  throw new Error('Unknown request: ' + path);
}
