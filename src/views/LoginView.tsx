/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { NavTab } from '../types';
import { APP_CONFIG } from '../constants/branding';
import {
  Smartphone,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  UserPlus,
  Sparkles,
  Users,
} from 'lucide-react';

interface LoginViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onNavigate }) => {
  const { loginWithContact, registeredProfiles, switchUser } = useAuth();
  const [contactNumber, setContactNumber] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await loginWithContact(contactNumber);
    setLoading(false);

    if (res.success) {
      onNavigate('home');
    } else {
      setError(res.error || 'Failed to login with this contact number.');
    }
  };

  const handleQuickSelect = (userId: string) => {
    switchUser(userId);
    onNavigate('home');
  };

  return (
    <div className="max-w-md mx-auto w-full py-4 sm:py-8">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl overflow-hidden">
        {/* Header Branding */}
        <div className="p-6 sm:p-8 bg-gradient-to-br from-blue-600/10 via-emerald-600/10 to-transparent border-b border-slate-100 dark:border-slate-800 text-center">
          <img
            src={APP_CONFIG.logoUrl}
            alt="JIT GROUP Logo"
            className="w-16 h-16 object-contain rounded-2xl bg-white p-1.5 shadow-md border border-slate-100 mx-auto mb-3"
          />
          <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Sign In to {APP_CONFIG.name}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Simple Contact Number Lookup · Passwordless & OTP-Free
          </p>
        </div>

        {/* Login Form */}
        <div className="p-6 sm:p-8 space-y-5">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Registered Contact Number
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="tel"
                  required
                  placeholder="e.g. +91 98765 43210"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                Enter your phone number to restore your profile and virtual rewards. No password or OTP required.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-2xl text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (contactNumber.trim()) {
                        try {
                          localStorage.setItem('jit_pending_phone', contactNumber.trim());
                        } catch (e) {}
                      }
                      onNavigate('register');
                    }}
                    className="block text-blue-600 dark:text-blue-400 font-bold underline text-[11px] mt-1"
                  >
                    Click here to Register New Profile with this number
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-2xl shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {loading ? 'Checking Account...' : 'Open Profile & Continue'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Switch to Register */}
          <div className="pt-2 text-center border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Don't have an account yet?{' '}
              <button
                type="button"
                onClick={() => {
                  if (contactNumber.trim()) {
                    try {
                      localStorage.setItem('jit_pending_phone', contactNumber.trim());
                    } catch (e) {}
                  }
                  onNavigate('register');
                }}
                className="text-blue-600 dark:text-blue-400 font-bold hover:underline"
              >
                Register New Profile
              </button>
            </p>
          </div>

          {/* Quick Demo Accounts Selection */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 mb-2.5 text-xs font-bold text-slate-700 dark:text-slate-300">
              <Users className="w-4 h-4 text-emerald-500" />
              <span>Or Sign In As Demo Profile:</span>
            </div>
            <div className="space-y-2">
              {registeredProfiles.slice(0, 3).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleQuickSelect(p.id)}
                  className="w-full flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-slate-200 dark:border-slate-700/80 transition-colors text-left group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={p.avatarUrl || APP_CONFIG.logoUrl}
                      alt={p.fullName}
                      className="w-8 h-8 rounded-full object-cover border border-slate-200"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {p.fullName}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono">
                        {p.contactNumber}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform">
                    Select →
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Transparency & Policy Disclosure */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Phase 2 Local Persistence</span>
            </div>
            <p>
              Profiles and sessions are stored in browser localStorage. Entering the same contact number immediately loads your saved profile, points, and posts without data loss.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
