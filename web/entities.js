// Entity definitions: drive DB schema, API, permissions and the UI forms/tables.
// t = field type: text | textarea | number | money | date | month | time | select | ref | multi | items | cadence | checklist | email | tel | password
// {sec:'Title'} renders a section heading. Entity extras: calendar {date}, filters [fields], actions [names handled in app.js]
const ALL = ['admin', 'manager', 'staff'];
const MGR = ['admin', 'manager'];
const ADM = ['admin'];

export const CONTRACT_TEMPLATE = `SERVICE AGREEMENT

This agreement is made on [date] between Redeye Digital Solutions ("Redeye") and [client name] ("Client").

1. Scope of work
Redeye will provide social-media content services as described in the attached package / quotation: [number] videos and [number] creatives per month, including planning, shooting, editing and delivery.

2. Fees and payment
The Client will pay [amount] per month. Invoices are payable within [7] days. A [50]% advance is due before work begins. Late payments may pause delivery.

3. Approvals and revisions
The Client will review and approve content within [2] working days of receiving it. [2] rounds of revisions are included per piece; further revisions are charged separately.

4. Ownership and usage
Final approved content belongs to the Client once fully paid. Redeye may show the work in its portfolio unless the Client objects in writing. Raw footage remains with Redeye.

5. Client responsibilities
The Client will provide brand assets, access and timely feedback, and ensure that products, claims and any people on camera are cleared for use.

6. Term and termination
This agreement runs for [number] months from the start date and may be ended by either party with [30] days written notice. Fees for work already delivered remain payable.

7. Confidentiality
Both parties will keep each other's non-public business information confidential.

8. General
This agreement is governed by the laws of India. Disputes will first be discussed in good faith before any legal action.

(Template only: have it reviewed by a lawyer before use.)`;

export const ENTITIES = {
  clients: {
    label: 'Clients', icon: '🏢', labelField: 'name',
    cols: ['name', 'contact_person', 'email', 'phone', 'status'],
    fields: [
      { k: 'name', l: 'Client / Company', t: 'text', req: 1 },
      { k: 'contact_person', l: 'Contact person', t: 'text' },
      { k: 'email', l: 'Email', t: 'email' },
      { k: 'phone', l: 'Phone', t: 'tel' },
      { k: 'gstin', l: 'GSTIN / Tax ID', t: 'text' },
      { k: 'code', l: 'Invoice code (e.g. GC)', t: 'text' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Active', 'Inactive', 'Prospect'], def: 'Active' },
      { k: 'address', l: 'Address', t: 'textarea' },
      { sec: 'Brand & account' },
      { k: 'account_manager_id', l: 'Account manager', t: 'ref', to: 'users' },
      { k: 'onboarded_on', l: 'Onboarded on', t: 'date' },
      { k: 'social_handles', l: 'Social handles (Instagram, YouTube, etc.)', t: 'textarea' },
      { k: 'drive_link', l: 'Shared Drive / assets folder link', t: 'text' },
      { k: 'brand_notes', l: 'Brand notes (tone, colours, do & don’t)', t: 'textarea' },
    ],
    actions: ['share_portal', 'client_report'],
    perms: { read: ALL, create: MGR, update: MGR, del: ADM },
  },
  leads: {
    label: 'Leads (CRM)', icon: '🎯', labelField: 'name', board: 'stage', calendar: { date: 'next_followup' }, filters: ['stage', 'owner_id', 'source'],
    cols: ['name', 'company', 'phone', 'source', 'stage', 'score', 'next_followup', 'owner_id'],
    bulk: true,
    fields: [
      { k: 'name', l: 'Lead name', t: 'text', req: 1 },
      { k: 'company', l: 'Company / brand', t: 'text' },
      { k: 'phone', l: 'Phone / WhatsApp', t: 'tel' },
      { k: 'email', l: 'Email', t: 'email' },
      { k: 'instagram', l: 'Instagram handle', t: 'text' },
      { k: 'website', l: 'Website', t: 'text' },
      { k: 'city', l: 'City', t: 'text' },
      { k: 'source', l: 'Source', t: 'select', opts: ['Instagram', 'WhatsApp', 'Website', 'Referral', 'Social media', 'Cold outreach', 'Ad campaign', 'Google Maps', 'Justdial', 'Event', 'Walk-in', 'Other'] },
      { k: 'campaign', l: 'Campaign', t: 'text' },
      { k: 'interest', l: 'Interested in', t: 'text' },
      { k: 'value', l: 'Expected value', t: 'money' },
      { k: 'stage', l: 'Stage', t: 'select', opts: ['New', 'Contacted', 'Replied', 'Meeting', 'Proposal', 'Won', 'Lost'], def: 'New' },
      { k: 'lost_reason', l: 'Why lost? (if Lost)', t: 'select', opts: ['Budget too high', 'No response', 'Went with a competitor', 'Not ready yet', 'Wrong fit', 'Other'] },
      { k: 'owner_id', l: 'Owner', t: 'ref', to: 'users' },
      { k: 'next_followup', l: 'Next follow-up', t: 'date' },
      { k: 'last_contact', l: 'Last contacted', t: 'date' },
      { k: 'tags', l: 'Tags (comma separated)', t: 'text' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
    ],
    // CSV import: column headings in the template, and the other names we accept for each field
    import: {
      template: ['Name', 'Company', 'Phone', 'Email', 'Instagram', 'Website', 'City', 'Source', 'Campaign', 'Interested in', 'Budget', 'Stage', 'Owner email', 'Next follow-up', 'Tags', 'Notes'],
      examples: [
        ['Priya Nair', 'Green Leaf Organics', '9876543210', 'priya@greenleaf.example', '@greenleaforganics', 'greenleaf.example', 'Coimbatore', 'Instagram', 'Nov reels push', 'Monthly reels package', '25000', 'New', '', '2026-12-05', 'organic, retail', 'Saw our reel, asked for pricing'],
        ['Karthik R', 'Sri Sakthi Jewellers', '9840012345', '', '@srisakthijewels', '', 'Pollachi', 'Cold outreach', 'Festive 2026', 'Festive video ads', '60000', 'Contacted', '', '2026-12-02', 'jewellery', 'Spoke on phone, send samples'],
      ],
      aliases: {
        name: ['name', 'full name', 'lead name', 'contact', 'contact name', 'person'], company: ['company', 'business', 'brand', 'organisation', 'organization', 'company name', 'business name'],
        phone: ['phone', 'mobile', 'whatsapp', 'contact number', 'phone number', 'mobile number', 'whatsapp number'], email: ['email', 'e-mail', 'mail', 'email id', 'email address'],
        instagram: ['instagram', 'insta', 'ig', 'instagram handle', 'instagram id'], website: ['website', 'url', 'site', 'web'], city: ['city', 'location', 'town', 'place'],
        source: ['source', 'lead source', 'channel', 'where from'], campaign: ['campaign', 'campaign name', 'ad', 'ad name'], interest: ['interested in', 'interest', 'service', 'service interested', 'requirement', 'needs'],
        value: ['budget', 'value', 'deal value', 'expected value'], stage: ['stage', 'status'], owner_id: ['owner email', 'owner', 'assigned to', 'assignee'],
        next_followup: ['next follow-up', 'next followup', 'follow up', 'follow-up date', 'followup date', 'next_followup'], last_contact: ['last contacted', 'last contact', 'last_contact'],
        tags: ['tags', 'tag', 'labels'], notes: ['notes', 'note', 'remarks', 'comments', 'comment'],
      },
    },
    actions: ['whatsapp_lead', 'log_followup', 'convert_lead'],
    perms: { read: ALL, create: MGR, update: MGR, del: ADM },
  },
  projects: {
    label: 'Projects', icon: '📁', labelField: 'name', board: 'status', filters: ['client_id', 'status'], actions: ['apply_template'],
    cols: ['name', 'client_id', 'status', 'due_date', 'budget', 'manager_id'],
    fields: [
      { k: 'name', l: 'Project name', t: 'text', req: 1 },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Planning', 'Active', 'On hold', 'Completed', 'Cancelled'], def: 'Planning' },
      { k: 'manager_id', l: 'Project manager', t: 'ref', to: 'users' },
      { k: 'start_date', l: 'Start date', t: 'date' },
      { k: 'due_date', l: 'Due date', t: 'date' },
      { k: 'budget', l: 'Budget', t: 'money' },
      { k: 'description', l: 'Description', t: 'textarea' },
    ],
    perms: { read: ALL, create: MGR, update: MGR, del: ADM },
  },
  tasks: {
    label: 'Tasks', icon: '✅', labelField: 'title', board: 'status', calendar: { date: 'due_date' }, filters: ['assignee_id', 'project_id', 'status'],
    cols: ['title', 'project_id', 'assignee_id', 'priority', 'status', 'due_date'],
    fields: [
      { k: 'title', l: 'Title', t: 'text', req: 1 },
      { k: 'project_id', l: 'Project', t: 'ref', to: 'projects' },
      { k: 'assignee_id', l: 'Assignee', t: 'ref', to: 'users' },
      { k: 'priority', l: 'Priority', t: 'select', opts: ['Low', 'Medium', 'High', 'Urgent'], def: 'Medium' },
      { k: 'status', l: 'Status', t: 'select', opts: ['To do', 'In progress', 'Review', 'Done'], def: 'To do' },
      { k: 'due_date', l: 'Due date', t: 'date' },
      { k: 'due_time', l: 'Due time (optional)', t: 'time' },
      { k: 'remind', l: 'Remind the assignee', t: 'select', opts: ['None', 'Morning of due date', 'At due time', '15 minutes before', '1 hour before', '3 hours before', '1 day before'], def: 'Morning of due date' },
      { k: 'nag_overdue', l: 'Nudge daily while overdue', t: 'select', opts: ['Yes', 'No'], def: 'Yes' },
      { k: 'description', l: 'Description', t: 'textarea' },
    ],
    actions: ['remind_task', 'snooze_task'],
    perms: { read: ALL, create: ALL, update: ALL, del: MGR },
  },
  invoices: {
    label: 'Invoices', icon: '🧾', labelField: 'number', calendar: { date: 'due_date' }, filters: ['client_id', 'status'],
    cols: ['number', 'client_id', 'issue_date', 'due_date', 'total', 'amount_paid', 'status'],
    fields: [
      { k: 'number', l: 'Invoice no. (leave empty for auto, e.g. RD/2026/GC-05)', t: 'text' },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients', req: 1 },
      { k: 'client_ref', l: 'Client ref. (e.g. GRAD & Co. – Branding)', t: 'text' },
      { k: 'project_id', l: 'Project', t: 'ref', to: 'projects' },
      { k: 'issue_date', l: 'Invoice date', t: 'date', def: 'today' },
      { k: 'due_date', l: 'Due date', t: 'date' },
      { k: 'items', l: 'Services', t: 'items' },
      { k: 'deductions', l: 'Less: advance / amount already received', t: 'deductions' },
      { k: 'tax_percent', l: 'Tax % (GST, 0 if none)', t: 'number', def: 0 },
      { k: 'carry_forward', l: 'Balance carried forward (optional)', t: 'number' },
      { k: 'videos_committed', l: 'Delivery status: videos committed (optional)', t: 'number' },
      { k: 'videos_delivered', l: 'Delivery status: videos delivered', t: 'number' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Draft', 'Sent', 'Partial', 'Paid', 'Overdue', 'Cancelled'], def: 'Draft' },
      { k: 'gst_mode', l: 'GST type (blank = no GST split)', t: 'select', opts: ['CGST + SGST (same state)', 'IGST (other state)'] },
      { k: 'subtotal', l: 'Subtotal', t: 'money', ro: 1, auto: 1 },
      { k: 'total', l: 'Payable now', t: 'money', ro: 1, auto: 1 },
      { k: 'amount_paid', l: 'Received so far', t: 'money', ro: 1, auto: 1 },
      { k: 'notes', l: 'Notes (one bullet per line)', t: 'textarea' },
    ],
    actions: ['record_payment', 'payment_request', 'whatsapp_invoice', 'email_invoice', 'whatsapp_reminder'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  expenses: {
    label: 'Expenses', icon: '💳', labelField: 'description', ownCol: 'created_by', filters: ['status', 'category'],
    cols: ['date', 'category', 'description', 'amount', 'status', 'created_by'],
    fields: [
      { k: 'date', l: 'Date', t: 'date', def: 'today', req: 1 },
      { k: 'category', l: 'Category', t: 'select', opts: ['Software & tools', 'Ad spend', 'Hosting', 'Freelancers', 'Travel', 'Office', 'Salaries', 'Other'] },
      { k: 'description', l: 'Description', t: 'text', req: 1 },
      { k: 'amount', l: 'Amount', t: 'money', req: 1 },
      { k: 'project_id', l: 'Project', t: 'ref', to: 'projects' },
      { k: 'client_id', l: 'Charge to client (for profitability)', t: 'ref', to: 'clients' },
      { k: 'freelancer_id', l: 'Paid to freelancer / vendor', t: 'ref', to: 'freelancers' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Pending', 'Approved', 'Rejected', 'Reimbursed'], def: 'Pending' },
    ],
    perms: { read: ALL, create: ALL, update: MGR, del: ADM },
  },
  employees: {
    label: 'Employees (HR)', icon: '👥', labelField: 'name',
    cols: ['name', 'designation', 'department', 'phone', 'join_date', 'status'],
    fields: [
      { k: 'name', l: 'Full name', t: 'text', req: 1 },
      { k: 'email', l: 'Email', t: 'email' },
      { k: 'phone', l: 'Phone', t: 'tel' },
      { k: 'designation', l: 'Designation', t: 'text' },
      { k: 'department', l: 'Department', t: 'select', opts: ['Management', 'Design', 'Development', 'Marketing', 'Sales', 'Accounts', 'Support', 'HR'] },
      { k: 'join_date', l: 'Joining date', t: 'date' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Active', 'On notice', 'Left'], def: 'Active' },
    ],
    perms: { read: MGR, create: ADM, update: ADM, del: ADM },
  },
  leaves: {
    label: 'Leave', icon: '🌴', labelField: 'type', ownCol: 'user_id', calendar: { date: 'from_date' }, filters: ['user_id', 'status'],
    cols: ['user_id', 'type', 'from_date', 'to_date', 'status'],
    fields: [
      { k: 'user_id', l: 'Employee', t: 'ref', to: 'users' },
      { k: 'type', l: 'Leave type', t: 'select', opts: ['Casual', 'Sick', 'Earned', 'Unpaid', 'Comp-off'], req: 1 },
      { k: 'from_date', l: 'From', t: 'date', req: 1 },
      { k: 'to_date', l: 'To', t: 'date', req: 1 },
      { k: 'reason', l: 'Reason', t: 'textarea' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Pending', 'Approved', 'Rejected'], def: 'Pending' },
    ],
    perms: { read: ALL, create: ALL, update: MGR, del: ADM },
  },
  attendance: {
    label: 'Attendance', icon: '🕘', labelField: 'date', ownCol: 'user_id',
    cols: ['date', 'user_id', 'check_in', 'check_out'],
    fields: [
      { k: 'user_id', l: 'Employee', t: 'ref', to: 'users' },
      { k: 'date', l: 'Date', t: 'date', def: 'today' },
      { k: 'check_in', l: 'Check in', t: 'text' },
      { k: 'check_out', l: 'Check out', t: 'text' },
    ],
    perms: { read: ALL, create: ADM, update: ADM, del: ADM },
  },
  tickets: {
    label: 'Support tickets', icon: '🎧', labelField: 'subject', board: 'status', filters: ['client_id', 'status'],
    cols: ['subject', 'client_id', 'priority', 'status', 'assignee_id'],
    fields: [
      { k: 'subject', l: 'Subject', t: 'text', req: 1 },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients' },
      { k: 'priority', l: 'Priority', t: 'select', opts: ['Low', 'Medium', 'High', 'Urgent'], def: 'Medium' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Open', 'In progress', 'Waiting', 'Resolved', 'Closed'], def: 'Open' },
      { k: 'assignee_id', l: 'Assignee', t: 'ref', to: 'users' },
      { k: 'description', l: 'Description', t: 'textarea' },
    ],
    perms: { read: ALL, create: ALL, update: ALL, del: MGR },
  },
  assets: {
    label: 'Assets & inventory', icon: '💻', labelField: 'name',
    cols: ['name', 'category', 'serial', 'assigned_to', 'status'],
    fields: [
      { k: 'name', l: 'Asset', t: 'text', req: 1 },
      { k: 'category', l: 'Category', t: 'select', opts: ['Laptop', 'Monitor', 'Phone', 'Camera', 'Furniture', 'Software licence', 'Other'] },
      { k: 'serial', l: 'Serial / licence key ref', t: 'text' },
      { k: 'assigned_to', l: 'Assigned to', t: 'ref', to: 'users' },
      { k: 'status', l: 'Status', t: 'select', opts: ['In use', 'In stock', 'Repair', 'Retired'], def: 'In stock' },
      { k: 'purchase_date', l: 'Purchase date', t: 'date' },
      { k: 'cost', l: 'Cost', t: 'money' },
    ],
    perms: { read: ALL, create: MGR, update: MGR, del: ADM },
  },
  quotes: {
    label: 'Quotations', icon: '📝', labelField: 'number', filters: ['client_id', 'status'],
    cols: ['number', 'client_id', 'title', 'valid_until', 'total', 'status'],
    fields: [
      { k: 'number', l: 'Quote no. (leave empty for auto)', t: 'text' },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients' },
      { k: 'lead_id', l: 'Or lead (if not a client yet)', t: 'ref', to: 'leads' },
      { k: 'title', l: 'Title (e.g. 12-video monthly package)', t: 'text', req: 1 },
      { k: 'issue_date', l: 'Date', t: 'date', def: 'today' },
      { k: 'valid_until', l: 'Valid until', t: 'date' },
      { k: 'items', l: 'Scope & pricing', t: 'items' },
      { k: 'tax_percent', l: 'Tax % (GST, 0 if none)', t: 'number', def: 0 },
      { k: 'status', l: 'Status', t: 'select', opts: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'], def: 'Draft' },
      { k: 'subtotal', l: 'Subtotal', t: 'money', ro: 1, auto: 1 },
      { k: 'total', l: 'Total', t: 'money', ro: 1, auto: 1 },
      { k: 'notes', l: 'Terms & notes (one bullet per line)', t: 'textarea' },
    ],
    actions: ['whatsapp_quote', 'email_quote', 'quote_print', 'quote_to_invoice'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  packages: {
    label: 'Retainers & packages', icon: '📦', labelField: 'name', filters: ['client_id', 'status'],
    cols: ['client_id', 'name', 'monthly_fee', 'videos_per_month', 'posts_per_month', 'status'],
    fields: [
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients', req: 1 },
      { k: 'name', l: 'Package name', t: 'text', req: 1 },
      { k: 'monthly_fee', l: 'Monthly fee', t: 'money' },
      { k: 'tax_percent', l: 'Tax %', t: 'number', def: 0 },
      { k: 'videos_per_month', l: 'Videos / month', t: 'number' },
      { k: 'posts_per_month', l: 'Static posts / carousels per month', t: 'number' },
      { k: 'shoots_per_month', l: 'Shoot days / month', t: 'number' },
      { k: 'billing_day', l: 'Invoice on day of month', t: 'number' },
      { k: 'start_date', l: 'Start date', t: 'date' },
      { k: 'end_date', l: 'End date', t: 'date' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Active', 'Paused', 'Ended'], def: 'Active' },
      { k: 'inclusions', l: 'What is included', t: 'textarea' },
    ],
    actions: ['raise_invoice'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  content_plans: {
    label: 'Content plans', icon: '🧭', labelField: 'title', filters: ['client_id', 'status'],
    cols: ['title', 'client_id', 'month', 'status'],
    fields: [
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients', req: 1 },
      { k: 'month', l: 'Month', t: 'month', req: 1 },
      { k: 'title', l: 'Plan title (e.g. December launch push)', t: 'text', req: 1 },
      { k: 'status', l: 'Status', t: 'select', opts: ['Draft', 'Pending approval', 'Approved', 'In production', 'Completed'], def: 'Draft' },
      { k: 'objective', l: 'Objective / campaign goal', t: 'textarea' },
      { k: 'themes', l: 'Content pillars & themes (one per line)', t: 'textarea' },
      { k: 'cadence', l: 'Posting cadence — slots that become the content calendar', t: 'cadence' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
    ],
    actions: ['generate_calendar', 'ai_plan_ideas', 'plan_approval_link'],
    perms: { read: ALL, create: MGR, update: MGR, del: MGR },
  },
  content_items: {
    label: 'Content calendar', icon: '🗓️', labelField: 'title', board: 'status', calendar: { date: 'publish_date' }, defaultMode: 'calendar',
    filters: ['client_id', 'status', 'format', 'owner_id'],
    cols: ['publish_date', 'title', 'client_id', 'format', 'platform', 'status', 'owner_id'],
    fields: [
      { sec: 'Plan' },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients', req: 1 },
      { k: 'plan_id', l: 'Content plan', t: 'ref', to: 'content_plans' },
      { k: 'title', l: 'Title / working name', t: 'text', req: 1 },
      { k: 'pillar', l: 'Content pillar', t: 'text' },
      { k: 'format', l: 'Format', t: 'select', opts: ['Reel', 'Carousel', 'Static post', 'Story', 'YouTube video', 'YouTube Short', 'Poster / creative', 'Article', 'Other'] },
      { k: 'platform', l: 'Platform', t: 'select', opts: ['Instagram', 'Facebook', 'YouTube', 'LinkedIn', 'X / Twitter', 'Threads', 'WhatsApp', 'Instagram + Facebook', 'All platforms'] },
      { k: 'publish_date', l: 'Publish date', t: 'date' },
      { k: 'publish_time', l: 'Publish time', t: 'time' },
      { k: 'status', l: 'Stage', t: 'select', opts: ['Idea', 'Scripting', 'Ready to shoot', 'Shoot scheduled', 'Shot', 'Editing', 'Internal review', 'Client review', 'Changes needed', 'Approved', 'Scheduled', 'Published'], def: 'Idea' },
      { k: 'owner_id', l: 'Account owner', t: 'ref', to: 'users' },
      { sec: 'Creative' },
      { k: 'concept', l: 'Concept / hook', t: 'textarea' },
      { k: 'script', l: 'Script / storyboard', t: 'textarea' },
      { k: 'caption', l: 'Caption', t: 'textarea' },
      { k: 'hashtags', l: 'Hashtags', t: 'text' },
      { sec: 'Production' },
      { k: 'writer_id', l: 'Writer', t: 'ref', to: 'users' },
      { k: 'editor_id', l: 'Editor', t: 'ref', to: 'users' },
      { k: 'designer_id', l: 'Designer', t: 'ref', to: 'users' },
      { k: 'shoot_id', l: 'Shoot', t: 'ref', to: 'shoots' },
      { k: 'edit_due', l: 'Edit due', t: 'date' },
      { k: 'asset_link', l: 'Drive / asset link (raw + final files)', t: 'text' },
      { sec: 'Client approval' },
      { k: 'client_status', l: 'Client status', t: 'select', opts: ['Not sent', 'Sent to client', 'Approved', 'Changes requested'], def: 'Not sent' },
      { k: 'client_feedback', l: 'Client feedback / revision notes', t: 'textarea' },
      { sec: 'Published & results' },
      { k: 'posted_url', l: 'Post link', t: 'text' },
      { k: 'posted_on', l: 'Posted on', t: 'date' },
      { k: 'views', l: 'Views', t: 'number' }, { k: 'reach', l: 'Reach', t: 'number' }, { k: 'likes', l: 'Likes', t: 'number' },
      { k: 'comments', l: 'Comments', t: 'number' }, { k: 'shares', l: 'Shares', t: 'number' }, { k: 'saves', l: 'Saves', t: 'number' },
    ],
    actions: ['approval_link', 'post_pack'],
    perms: { read: ALL, create: ALL, update: ALL, del: MGR },
  },
  shoots: {
    label: 'Shoot schedule', icon: '🎬', labelField: 'title', board: 'status', calendar: { date: 'shoot_date' }, defaultMode: 'calendar',
    filters: ['client_id', 'status'],
    cols: ['shoot_date', 'call_time', 'title', 'client_id', 'location', 'status', 'director_id'],
    fields: [
      { k: 'title', l: 'Shoot title', t: 'text', req: 1 },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients' },
      { k: 'shoot_date', l: 'Date', t: 'date', req: 1 },
      { k: 'call_time', l: 'Call time', t: 'time' },
      { k: 'wrap_time', l: 'Expected wrap', t: 'time' },
      { k: 'location', l: 'Location / address', t: 'text' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Planned', 'Confirmed', 'Completed', 'Cancelled', 'Postponed'], def: 'Planned' },
      { k: 'director_id', l: 'Lead / director', t: 'ref', to: 'users' },
      { k: 'crew_ids', l: 'Crew (team members on this shoot)', t: 'multi', to: 'users' },
      { k: 'equipment_ids', l: 'Equipment (from assets)', t: 'multi', to: 'assets' },
      { k: 'talent', l: 'Talent / people on camera', t: 'textarea' },
      { k: 'props', l: 'Props, wardrobe & permissions', t: 'textarea' },
      { k: 'content_pick', l: 'Content pieces to shoot (tick to attach)', t: 'itempick', virtual: 1 },
      { k: 'shot_list', l: 'Shot list', t: 'textarea' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
    ],
    actions: ['call_sheet', 'apply_template'],
    perms: { read: ALL, create: MGR, update: ALL, del: MGR },
  },
  meetings: {
    label: 'Meetings', icon: '🤝', labelField: 'title', calendar: { date: 'meeting_date' }, filters: ['client_id', 'status'],
    cols: ['meeting_date', 'meeting_time', 'title', 'client_id', 'kind', 'status'],
    fields: [
      { k: 'title', l: 'Meeting', t: 'text', req: 1 },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients' },
      { k: 'kind', l: 'Type', t: 'select', opts: ['Sales call', 'Kickoff', 'Content review', 'Monthly review', 'Shoot briefing', 'Internal', 'Other'] },
      { k: 'meeting_date', l: 'Date', t: 'date', def: 'today' },
      { k: 'meeting_time', l: 'Time', t: 'time' },
      { k: 'location', l: 'Place / call link', t: 'text' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Scheduled', 'Done', 'Cancelled'], def: 'Scheduled' },
      { k: 'attendees', l: 'Attendees', t: 'text' },
      { k: 'agenda', l: 'Agenda', t: 'textarea' },
      { k: 'minutes', l: 'Minutes / discussion', t: 'textarea' },
      { k: 'action_items', l: 'Action items', t: 'textarea' },
    ],
    perms: { read: ALL, create: ALL, update: ALL, del: MGR },
  },
  freelancers: {
    label: 'Freelancers & vendors', icon: '🎥', labelField: 'name', filters: ['role', 'status'],
    cols: ['name', 'role', 'phone', 'city', 'rate', 'status'],
    fields: [
      { k: 'name', l: 'Name', t: 'text', req: 1 },
      { k: 'role', l: 'Role', t: 'select', opts: ['Videographer', 'Photographer', 'Editor', 'Designer', 'Model / talent', 'Voice-over', 'Makeup / styling', 'Drone operator', 'Equipment rental', 'Studio', 'Other'] },
      { k: 'phone', l: 'Phone', t: 'tel' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'city', l: 'City', t: 'text' },
      { k: 'rate', l: 'Rate', t: 'money' },
      { k: 'rate_unit', l: 'Rate per', t: 'select', opts: ['Hour', 'Day', 'Video', 'Project', 'Month'] },
      { k: 'portfolio_link', l: 'Portfolio link', t: 'text' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Available', 'Busy', 'Blacklisted'], def: 'Available' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
    ],
    actions: ['freelancer_ledger'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  contracts: {
    label: 'Contracts', icon: '✍️', labelField: 'title', filters: ['client_id', 'status'],
    cols: ['title', 'client_id', 'status', 'signed_name', 'signed_at'],
    fields: [
      { k: 'title', l: 'Contract title', t: 'text', req: 1 },
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Draft', 'Sent', 'Signed', 'Declined'], def: 'Draft' },
      { k: 'body', l: 'Contract text (the client sees exactly this)', t: 'textarea', def: CONTRACT_TEMPLATE },
      { k: 'signed_name', l: 'Signed by', t: 'text', ro: 1, auto: 1 },
      { k: 'signed_at', l: 'Signed at', t: 'text', ro: 1, auto: 1 },
    ],
    actions: ['share_contract', 'print_contract'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  payments: {
    label: 'Payments received', icon: '💵', labelField: 'reference', filters: ['method'],
    cols: ['paid_on', 'invoice_id', 'amount', 'method', 'reference'],
    fields: [
      { k: 'invoice_id', l: 'Invoice', t: 'ref', to: 'invoices', req: 1 },
      { k: 'amount', l: 'Amount received', t: 'money', req: 1 },
      { k: 'paid_on', l: 'Received on', t: 'date', def: 'today', req: 1 },
      { k: 'method', l: 'Method', t: 'select', opts: ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'] },
      { k: 'reference', l: 'Reference / UTR / cheque no.', t: 'text' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
    ],
    actions: ['receipt'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  payment_requests: {
    label: 'Payment requests', icon: '💸', labelField: 'purpose', filters: ['client_id', 'status'],
    cols: ['client_id', 'purpose', 'amount', 'due_date', 'status', 'claimed_ref'],
    fields: [
      { k: 'client_id', l: 'Client', t: 'ref', to: 'clients', req: 1 },
      { k: 'invoice_id', l: 'Invoice (optional)', t: 'ref', to: 'invoices' },
      { k: 'amount', l: 'Amount requested', t: 'money', req: 1 },
      { k: 'purpose', l: 'Purpose (e.g. 50% advance for December)', t: 'text', req: 1 },
      { k: 'due_date', l: 'Pay by', t: 'date' },
      { k: 'status', l: 'Status', t: 'select', opts: ['Open', 'Paid claimed', 'Paid', 'Cancelled'], def: 'Open' },
      { k: 'claimed_ref', l: 'Reference given by client', t: 'text', ro: 1, auto: 1 },
    ],
    actions: ['send_payment_request', 'confirm_request_paid'],
    perms: { read: MGR, create: MGR, update: MGR, del: ADM },
  },
  equipment_log: {
    label: 'Equipment log', icon: '🎒', labelField: 'asset_id', filters: ['asset_id', 'user_id'],
    cols: ['asset_id', 'user_id', 'out_date', 'due_back', 'returned_on'],
    fields: [
      { k: 'asset_id', l: 'Equipment', t: 'ref', to: 'assets', req: 1 },
      { k: 'user_id', l: 'Taken by', t: 'ref', to: 'users' },
      { k: 'shoot_id', l: 'For shoot', t: 'ref', to: 'shoots' },
      { k: 'out_date', l: 'Taken on', t: 'date', def: 'today', req: 1 },
      { k: 'due_back', l: 'Due back', t: 'date' },
      { k: 'returned_on', l: 'Returned on', t: 'date' },
      { k: 'condition_out', l: 'Condition when taken', t: 'text' },
      { k: 'condition_in', l: 'Condition when returned (mention damage)', t: 'text' },
      { k: 'notes', l: 'Notes', t: 'textarea' },
    ],
    actions: ['mark_returned'],
    perms: { read: ALL, create: ALL, update: ALL, del: MGR },
  },
  task_templates: {
    label: 'Task templates', icon: '📋', labelField: 'name',
    cols: ['name', 'description'],
    fields: [
      { k: 'name', l: 'Template name', t: 'text', req: 1 },
      { k: 'description', l: 'When to use it', t: 'text' },
      { k: 'items', l: 'Checklist: task, days from the start date (negative = before), priority', t: 'checklist' },
    ],
    perms: { read: ALL, create: MGR, update: MGR, del: MGR },
  },
  users: {
    label: 'Users & access', icon: '🔐', labelField: 'name',
    cols: ['name', 'email', 'role', 'active'],
    fields: [
      { k: 'name', l: 'Name', t: 'text', req: 1 },
      { k: 'email', l: 'Login email', t: 'email', req: 1 },
      { k: 'role', l: 'Role', t: 'select', opts: ['admin', 'manager', 'staff'], def: 'staff', req: 1 },
      { k: 'active', l: 'Active', t: 'select', opts: ['Yes', 'No'], def: 'Yes' },
      { k: 'password', l: 'Password (min 8 chars; leave blank to keep)', t: 'password', virtual: 1 },
    ],
    perms: { read: ALL, create: ADM, update: ADM, del: ADM },
  },
};

// Sidebar sections (order = workflow order: win work → plan content → shoot & produce → deliver → bill).
export const NAV_GROUPS = [
  ['Sales', ['leads', 'quotes', 'contracts', 'clients', 'packages']],
  ['Content studio', ['content_plans', 'content_items', 'shoots', 'freelancers']],
  ['Delivery', ['projects', 'tasks', 'task_templates', 'meetings']],
  ['Finance', ['invoices', 'payments', 'payment_requests', 'expenses']],
  ['People & ops', ['employees', 'leaves', 'attendance', 'assets', 'equipment_log', 'tickets']],
  ['Admin', ['users']],
];
export const NAV = NAV_GROUPS.flatMap(([, ks]) => ks);

// Pages that are not plain record lists (built in app.js). roles = who sees them in the menu.
export const CUSTOM_PAGES = [
  { k: 'followups', icon: '📞', label: 'Follow-up queue', group: 'Sales', roles: MGR },
  { k: 'crm', icon: '📊', label: 'Marketing analytics', group: 'Sales', roles: MGR },
  { k: 'workload', icon: '👷', label: 'Team workload', group: 'Delivery', roles: ALL },
  { k: 'receivables', icon: '💰', label: 'Receivables', group: 'Finance', roles: MGR },
  { k: 'profitability', icon: '📈', label: 'Profitability', group: 'Finance', roles: MGR },
];
