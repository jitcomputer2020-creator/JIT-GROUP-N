/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Automated 180-Day Inactive Account Cleanup Edge Function
 * Schedule: Runs daily via Supabase cron or GitHub Actions / pg_cron
 * 
 * Invocation:
 * curl -X POST https://<project-ref>.supabase.co/functions/v1/inactive-account-cleanup \
 *   -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>"
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INACTIVITY_THRESHOLD_DAYS = 180;

serve(async (req) => {
  // Enforce method
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Create elevated service-role client
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - INACTIVITY_THRESHOLD_DAYS);
    const cutoffIso = cutoffDate.toISOString();

    console.log(`[JIT Inactivity Cron] Querying accounts with last_login_at < ${cutoffIso} (older than ${INACTIVITY_THRESHOLD_DAYS} days)`);

    // 1. Fetch eligible accounts for audit logging before deletion
    const { data: eligibleUsers, error: queryError } = await supabase
      .from('profiles')
      .select('id, contact_number, full_name, last_login_at, created_at')
      .lt('last_login_at', cutoffIso);

    if (queryError) {
      console.error('[JIT Inactivity Cron] Query error:', queryError);
      throw queryError;
    }

    const count = eligibleUsers ? eligibleUsers.length : 0;
    console.log(`[JIT Inactivity Cron] Found ${count} inactive account(s) eligible for automated deletion`);

    if (count === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No accounts exceed the 180-day inactivity limit.',
          deletedCount: 0,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Perform deletion using Postgres procedure or bulk delete
    const userIds = eligibleUsers.map((u) => u.id);

    // Clean up storage assets for these users if bucket files exist
    for (const user of eligibleUsers) {
      try {
        const userFolder = `user_${user.id}`;
        // List files in avatars, stories, reels buckets
        const buckets = ['avatars', 'stories', 'reels', 'post-media'];
        for (const bucket of buckets) {
          const { data: files } = await supabase.storage.from(bucket).list(userFolder);
          if (files && files.length > 0) {
            const filePaths = files.map((f) => `${userFolder}/${f.name}`);
            await supabase.storage.from(bucket).remove(filePaths);
          }
        }
      } catch (storageErr) {
        console.warn(`[Storage Cleanup Warning] User ${user.id}:`, storageErr);
      }
    }

    // 3. Execute database deletion (Cascades cleanly across posts, messages, games, etc.)
    const { error: deleteError } = await supabase
      .from('profiles')
      .delete()
      .in('id', userIds);

    if (deleteError) {
      console.error('[JIT Inactivity Cron] Deletion error:', deleteError);
      throw deleteError;
    }

    console.log(`[JIT Inactivity Cron] Successfully purged ${count} inactive account(s)`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully purged ${count} inactive account(s) inactive for >= ${INACTIVITY_THRESHOLD_DAYS} days.`,
        deletedCount: count,
        purgedUserIds: userIds,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error executing account cleanup' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
