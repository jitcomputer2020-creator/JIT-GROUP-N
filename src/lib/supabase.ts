/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuration keys for local overrides
const LS_URL_KEY = 'jit_supabase_url';
const LS_ANON_KEY = 'jit_supabase_anon_key';

export interface SupabaseConfigState {
  url: string;
  anonKey: string;
  isConfigured: boolean;
  isConnected: boolean;
  lastChecked?: string;
  error?: string | null;
}

// Retrieve configured or environment credentials
export function getStoredSupabaseConfig(): { url: string; anonKey: string } {
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

  const storedUrl = typeof window !== 'undefined' ? localStorage.getItem(LS_URL_KEY) || '' : '';
  const storedAnonKey = typeof window !== 'undefined' ? localStorage.getItem(LS_ANON_KEY) || '' : '';

  const effectiveUrl = (storedUrl || envUrl).trim();
  const effectiveAnonKey = (storedAnonKey || envAnonKey).trim();

  return {
    url: effectiveUrl,
    anonKey: effectiveAnonKey,
  };
}

let supabaseInstance: SupabaseClient | null = null;
let currentConfigUrl = '';
let currentConfigKey = '';

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey } = getStoredSupabaseConfig();

  // Validate placeholder values
  const isDummyUrl = !url || url.includes('your-project.supabase.co');
  const isDummyKey = !anonKey || anonKey === 'your-anon-key-here';

  if (isDummyUrl || isDummyKey) {
    return null;
  }

  if (supabaseInstance && currentConfigUrl === url && currentConfigKey === anonKey) {
    return supabaseInstance;
  }

  try {
    supabaseInstance = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    currentConfigUrl = url;
    currentConfigKey = anonKey;
    return supabaseInstance;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

// Health check function to verify live connection
export async function testSupabaseConnection(url?: string, anonKey?: string): Promise<{ success: boolean; message: string }> {
  const testUrl = url || getStoredSupabaseConfig().url;
  const testKey = anonKey || getStoredSupabaseConfig().anonKey;

  if (!testUrl || testUrl.includes('your-project.supabase.co')) {
    return { success: false, message: 'Supabase URL is not configured or still set to placeholder.' };
  }
  if (!testKey || testKey === 'your-anon-key-here') {
    return { success: false, message: 'Supabase Anon Key is missing or invalid.' };
  }

  try {
    const tempClient = createClient(testUrl, testKey);
    // Ping with a lightweight query to verify connectivity
    const { error } = await tempClient.from('profiles').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      // Table might not exist yet, but credentials could still be valid
      if (error.message?.includes('relation "public.profiles" does not exist')) {
        return {
          success: true,
          message: 'Connected to Supabase! (Database schema not yet migrated - run schema.sql in Supabase SQL editor)',
        };
      }
      return { success: false, message: error.message };
    }
    return { success: true, message: 'Successfully connected to Supabase PostgreSQL database & Realtime!' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Network error connecting to Supabase instance.' };
  }
}

// Save credentials from UI
export function saveCustomSupabaseConfig(url: string, anonKey: string): void {
  if (typeof window !== 'undefined') {
    if (url) localStorage.setItem(LS_URL_KEY, url.trim());
    else localStorage.removeItem(LS_URL_KEY);

    if (anonKey) localStorage.setItem(LS_ANON_KEY, anonKey.trim());
    else localStorage.removeItem(LS_ANON_KEY);

    supabaseInstance = null; // force re-instantiation
  }
}
