/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Server,
  Key,
  Shield,
  Clock,
} from 'lucide-react';
import {
  getStoredSupabaseConfig,
  saveCustomSupabaseConfig,
  testSupabaseConnection,
} from '../../lib/supabase';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({ isOpen, onClose }) => {
  const currentConfig = getStoredSupabaseConfig();
  const [url, setUrl] = useState(currentConfig.url);
  const [anonKey, setAnonKey] = useState(currentConfig.anonKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleTestAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setTestResult(null);

    // Save config first
    saveCustomSupabaseConfig(url, anonKey);

    const res = await testSupabaseConnection(url, anonKey);
    setTesting(false);
    setTestResult(res);
  };

  const copySqlNotice = () => {
    navigator.clipboard.writeText('-- Run supabase/schema.sql in your Supabase SQL Editor to initialize all 30 tables and triggers.');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isConnected = testResult?.success;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Supabase & PostgreSQL Integration
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Phase 1 Configuration & Live Health Status
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Status Banner */}
          <div
            className={`p-4 rounded-2xl border flex items-start gap-3 ${
              isConnected
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
                : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/50 text-blue-800 dark:text-blue-300'
            }`}
          >
            {isConnected ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
            )}
            <div className="text-xs leading-relaxed">
              <p className="font-semibold mb-0.5">
                {isConnected ? 'Supabase Database Connected' : 'Hybrid Local & Supabase Engine Active'}
              </p>
              <p className="opacity-90">
                {testResult?.message ||
                  'JIT GROUP includes a complete offline-ready local state engine so every feed, reel, game, tournament, and theme works immediately. Connect your live Supabase project below to persist data to the cloud.'}
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleTestAndSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-slate-400" />
                VITE_SUPABASE_URL
              </label>
              <input
                type="url"
                placeholder="https://xyzcompany.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                VITE_SUPABASE_ANON_KEY
              </label>
              <input
                type="text"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                className="w-full px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={testing}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-md shadow-emerald-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              {testing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <Database className="w-3.5 h-3.5" />
                  Save & Test Supabase Connection
                </>
              )}
            </button>
          </form>

          {/* Architecture Checklist */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Supabase Architectural Setup Delivered:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white mb-1">
                  <Database className="w-3.5 h-3.5 text-blue-500" />
                  <span>30 PostgreSQL Tables</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ready in <code className="text-[10px] text-blue-600 dark:text-blue-400 font-mono">/supabase/schema.sql</code>
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white mb-1">
                  <Shield className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Row Level Security</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Locked in <code className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">/supabase/rls.sql</code>
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white mb-1">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <span>180-Day Inactivity Cron</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Edge Function in <code className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">/supabase/functions/</code>
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white mb-1">
                  <Server className="w-3.5 h-3.5 text-purple-500" />
                  <span>8 Storage Buckets</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Configured in <code className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">STORAGE_SETUP.sql</code>
                </p>
              </div>
            </div>

            <button
              onClick={copySqlNotice}
              className="w-full mt-2 py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied migration instruction!' : 'Copy SQL Schema Setup Command'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
