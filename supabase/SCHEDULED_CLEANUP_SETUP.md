# JIT GROUP - 180-Day Automated Inactivity Cleanup Guide

As mandated by JIT GROUP policy, accounts with no logins for 180 consecutive days are automatically deleted without requiring manual admin approval.

---

## Technical Mechanism

1. **Timestamp Recording**: Every time a user signs in via Contact Number, the `profiles.last_login_at` timestamp is updated to `NOW()`.
2. **Server-Side Cleanup Procedure**: A PostgreSQL stored function `delete_inactive_accounts()` in `/supabase/schema.sql` performs the deletion. Cascading foreign keys (`ON DELETE CASCADE`) clean up posts, comments, reactions, conversations, reels, and wallets automatically.
3. **Storage Purge**: The Supabase Edge Function `/supabase/functions/inactive-account-cleanup/index.ts` purges corresponding user files from the storage buckets before removing the record.

---

## Option 1: Native Supabase `pg_cron` (Recommended)

In your Supabase SQL Editor, run:

```sql
-- Enable pg_cron extension if not enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the cleanup function to run every day at 03:00 AM UTC
SELECT cron.schedule(
    'daily-jit-inactive-cleanup',
    '0 3 * * *',
    $$ SELECT public.delete_inactive_accounts(); $$
);
```

---

## Option 2: Deploying the Edge Function via Supabase CLI

```bash
# 1. Login to Supabase CLI
supabase login

# 2. Link your project
supabase link --project-ref your-project-ref

# 3. Deploy the Edge Function
supabase functions deploy inactive-account-cleanup --no-verify-jwt
```

Then trigger it daily via GitHub Actions or any external cron service:
```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/inactive-account-cleanup \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
```
