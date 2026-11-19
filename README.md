# Redeye ERP (Supabase edition)

Login-based web app for Redeye Digital Solutions. Runs in any browser, installable as an app
(Windows / Mac / Android / iOS), with browser push notifications.

- `web/` – the app (static files: HTML/CSS/JS, no build step)
- `supabase/migrations/` – database, security rules (RLS), business rules, reminders
- `supabase/functions/` – `send-push` (web push) and `admin-users` (create/edit logins)

## Setup (about 20 minutes, all free tier)

### 1. Create the project
supabase.com → New project. Note the **Project URL** and **anon public key** (Project Settings → API).

### 2. Database
1. Database → Extensions → enable **pg_net** and **pg_cron**.
2. SQL Editor → paste & run `supabase/migrations/001_schema.sql`, then `002_optional_extensions.sql`.

### 3. First admin
Authentication → Users → **Add user** → *Create new user*, tick *Auto Confirm User*.
**The first user ever created becomes the admin.** Then Authentication → Sign In / Providers →
turn **off** "Allow new users to sign up" (admins add staff from inside the app: *Users & access*).

### 4. Push notifications
```bash
npx web-push generate-vapid-keys        # prints a public and a private key
npm i -g supabase && supabase login && supabase link --project-ref YOUR-REF
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@yourdomain.com WEBHOOK_SECRET=$(openssl rand -hex 24)
supabase functions deploy send-push --no-verify-jwt
supabase functions deploy admin-users
```
Then in SQL Editor (use the same WEBHOOK_SECRET value):
```sql
insert into app_settings (key, value) values
  ('push_url',    'https://YOUR-REF.supabase.co/functions/v1/send-push'),
  ('push_secret', 'THE-WEBHOOK-SECRET');
```

### 5. Configure and host the web app
Edit `web/config.js` (URL, anon key, VAPID **public** key). Host the `web/` folder on any free HTTPS static
host — Cloudflare Pages, Netlify, Vercel or GitHub Pages (publish directory: `web`, no build command).
Local preview: `npm run dev` → http://localhost:8080

### 6. Use it
Sign in → Settings → **Enable on this device** → **Send test**. Add staff in *Users & access*
(roles: admin = everything, manager = no user/HR admin, staff = own expenses/leave + tasks/tickets).

## Notes
- Security is enforced in Postgres (row-level security), not in the browser; the anon key is meant to be public.
  Never put the `service_role` key in `web/`.
- Installing: Chrome/Edge → menu → Install; Mac Safari → File → Add to Dock; iPhone → Share → Add to Home Screen
  (iOS push only works from the installed icon, iOS 16.4+).
- Attendance times use Asia/Kolkata; change with `alter database postgres set app.tz = 'Your/Zone';`.
- Currency is INR; change `CURRENCY`/`LOCALE` at the top of `web/app.js`.
- Free Supabase projects pause after a period of inactivity; check current free-tier limits on supabase.com/pricing.
