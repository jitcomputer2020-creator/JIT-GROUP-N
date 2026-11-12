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
  User,
  MapPin,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  LogIn,
} from 'lucide-react';

interface RegisterViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const RegisterView: React.FC<RegisterViewProps> = ({ onNavigate }) => {
  const { registerUser } = useAuth();
  const [contactNumber, setContactNumber] = useState(() => {
    if (typeof window !== 'undefined') {
      const pending = localStorage.getItem('jit_pending_phone');
      if (pending) {
        localStorage.removeItem('jit_pending_phone');
        return pending;
      }
    }
    return '';
  });
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const res = await registerUser(contactNumber, fullName, address);
    setLoading(false);

    if (res.success && res.user) {
      if (res.isExisting) {
        setSuccess(`Welcome back, ${res.user.fullName}! Your existing profile and ${res.user.stats.rewardPoints} reward points are preserved.`);
      } else {
        setSuccess(`Welcome to JIT GROUP, ${res.user.fullName}! Permanent User ID: ${res.user.id} (100 Welcome Points awarded)`);
      }
      setTimeout(() => {
        onNavigate('profile');
      }, 1200);
    } else {
      setError(res.error || 'Registration failed. Please try again.');
    }
  };

  return (
    <div className="max-w-md mx-auto w-full py-4 sm:py-8">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl overflow-hidden">
        {/* Header Branding */}
        <div className="p-6 sm:p-8 bg-gradient-to-br from-emerald-600/10 via-blue-600/10 to-transparent border-b border-slate-100 dark:border-slate-800 text-center">
          <img
            src={APP_CONFIG.logoUrl}
            alt="JIT GROUP Logo"
            className="w-16 h-16 object-contain rounded-2xl bg-white p-1.5 shadow-md border border-slate-100 mx-auto mb-3"
          />
          <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Register at {APP_CONFIG.name}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Create your permanent student / faculty campus profile
          </p>
        </div>

        {/* Registration Form */}
        <div className="p-6 sm:p-8 space-y-5">
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Contact Number <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="tel"
                  required
                  placeholder="e.g. +91 98765 00000"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Acts as your account lookup key. Stored privately by default.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Full Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Address / Campus Location <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. JIT Hostel 2, Room 304, Sector 12"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
                />
              </div>
            </div>

            {/* Mandatory 180-Day Inactivity Notice */}
            <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-[11px] text-amber-900 dark:text-amber-300 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Notice: 180-Day Inactivity Account Rule</span>
              </div>
              <p className="leading-relaxed opacity-95">
                Accounts without login activity for 180 consecutive days are automatically deleted by scheduled maintenance. Log in periodically to keep your profile active.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-2xl text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <span>{success}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-2xl shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                'Creating Profile...'
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Register Profile & Claim 100 Points</span>
                </>
              )}
            </button>
          </form>

          {/* Switch to Login */}
          <div className="pt-2 text-center border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Already registered with this number?{' '}
              <button
                type="button"
                onClick={() => onNavigate('login')}
                className="text-blue-600 dark:text-blue-400 font-bold hover:underline"
              >
                Sign In with Contact Number
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
