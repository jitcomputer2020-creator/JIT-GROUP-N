/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { APP_CONFIG } from '../../constants/branding';
import { X, Smartphone, User, MapPin, AlertCircle, CheckCircle2, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, defaultTab = 'login' }) => {
  const { loginWithContact, registerUser, registeredProfiles, switchUser } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>(defaultTab);

  // Login form state
  const [loginPhone, setLoginPhone] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Register form state
  const [regPhone, setRegPhone] = useState('');
  const [regName, setRegName] = useState('');
  const [regAddress, setRegAddress] = useState('');
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    const res = await loginWithContact(loginPhone);
    setLoginLoading(false);

    if (res.success) {
      onClose();
    } else {
      setLoginError(res.error || 'Failed to login');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');
    setRegSuccess('');
    setRegLoading(true);

    const res = await registerUser(regPhone, regName, regAddress);
    setRegLoading(false);

    if (res.success) {
      if (res.isExisting) {
        setRegSuccess(`Welcome back, ${res.user?.fullName || 'User'}! Profile recognized and restored without data loss.`);
      } else {
        setRegSuccess('Profile created successfully! Welcome to JIT GROUP (100 Welcome Points awarded).');
      }
      setTimeout(() => {
        onClose();
      }, 1000);
    } else {
      setRegError(res.error || 'Registration failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header Branding */}
        <div className="relative p-6 pb-4 bg-gradient-to-br from-blue-600/10 via-emerald-600/10 to-transparent border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <img
              src={APP_CONFIG.logoUrl}
              alt="JIT GROUP Logo"
              className="w-12 h-12 object-contain rounded-xl bg-white p-1 shadow-sm border border-slate-100"
            />
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                {APP_CONFIG.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Contact Number Profile Access
              </p>
            </div>
          </div>

          {/* Segmented Tab Controls */}
          <div className="flex mt-4 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              onClick={() => { setTab('login'); setLoginError(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                tab === 'login'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Sign In with Contact
            </button>
            <button
              onClick={() => { setTab('register'); setRegError(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                tab === 'register'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              New Registration
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Registered Contact Number
                </label>
                <div className="relative">
                  <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +91 98765 43210"
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Passwordless & OTP-free: Your profile is identified by your contact number.
                </p>
              </div>

              {loginError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-blue-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {loginLoading ? 'Looking up profile...' : 'Open Profile'}
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Fast Demo Accounts */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                  Quick Switch Demo Accounts:
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {registeredProfiles.slice(0, 3).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        switchUser(p.id);
                        onClose();
                      }}
                      className="w-full flex items-center justify-between p-2 text-left rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-slate-200 dark:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <img
                          src={p.avatarUrl || APP_CONFIG.logoUrl}
                          alt={p.fullName}
                          className="w-6 h-6 rounded-full object-cover border border-slate-200"
                        />
                        <div>
                          <p className="text-xs font-medium text-slate-900 dark:text-white truncate max-w-[170px]">
                            {p.fullName}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono">
                            {p.contactNumber}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">Select</span>
                    </button>
                  ))}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contact Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 00000"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul Sharma"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Address / Campus Hostel <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. JIT Hostel 2, Room 304"
                    value={regAddress}
                    onChange={(e) => setRegAddress(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* Mandatory 180-Day Inactive Notice */}
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl text-[11px] text-amber-800 dark:text-amber-300">
                <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Notice: 180-Day Inactivity Deletion Policy</span>
                </div>
                <p>
                  To keep JIT GROUP secure and clean, accounts with no logins for 180 consecutive days are automatically deleted by scheduled backend maintenance. Log in periodically to keep your profile active.
                </p>
              </div>

              {regError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              {regSuccess && (
                <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{regSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={regLoading}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-emerald-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {regLoading ? 'Registering...' : 'Register Profile & Claim 100 Points'}
                <Sparkles className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
