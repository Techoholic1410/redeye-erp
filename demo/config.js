// Fill these in from Supabase → Project Settings → API  (the anon key is safe to expose; row-level security protects data)
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
// Generate once with:  npx web-push generate-vapid-keys   (public key here, private key goes in Edge Function secrets)
export const VAPID_PUBLIC_KEY = 'YOUR-VAPID-PUBLIC-KEY';
