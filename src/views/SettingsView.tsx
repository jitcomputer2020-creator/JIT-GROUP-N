/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth, BUILT_IN_DEMO_PROFILE_IDS } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { NavTab, ThemeMode } from '../types';
import {
  Sun,
  Moon,
  Laptop,
  LogOut,
  Clock,
  CheckCircle2,
  Lock,
  Layers,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';

interface SettingsViewProps {
  onNavigate: (tab: NavTab) => void;
  onOpenAuth: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onNavigate,
  onOpenAuth,
}) => {
  const { currentUser, logout, updateProfile, deleteOwnAccount, daysRemaining } = useAuth();
  const { theme, setTheme } = useTheme();

  // Settings toggles
  const [isPhonePublic, setIsPhonePublic] = useState(currentUser?.isContactNumberPublic || false);
  const [isAddressPublic, setIsAddressPublic] = useState(currentUser?.isAddressPublic || false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isProtectedDemoAccount = currentUser
    ? BUILT_IN_DEMO_PROFILE_IDS.has(currentUser.id)
    : false;

  const handleSavePrivacy = async () => {
    if (!currentUser) return;
    await updateProfile({
      isContactNumberPublic: isPhonePublic,
      isAddressPublic: isAddressPublic,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleConfirmDeleteAccount = async () => {
    setDeleteError('');
    setDeletingAccount(true);
    const res = await deleteOwnAccount();
    setDeletingAccount(false);
    if (res.success) {
      setShowDeleteConfirm(false);
      onNavigate('login');
    } else {
      setDeleteError(res.error || 'Could not delete account right now.');
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto w-full">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
          Settings & Account Governance
        </h2>
        <p className="text-xs text-slate-500">
          Manage your theme, notification preferences, privacy rules, and account retention.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Privacy preferences updated successfully!</span>
        </div>
      )}

      {/* 1. Theme Configuration */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" />
          <span>Appearance & Theme</span>
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Choose your interface theme. Your preference is automatically remembered.
        </p>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {(
            [
              { id: 'dark', label: 'Dark Theme', icon: Moon },
              { id: 'light', label: 'Light Theme', icon: Sun },
              { id: 'system', label: 'System Default', icon: Laptop },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isSelected = theme === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTheme(item.id as ThemeMode)}
                className={`p-2.5 sm:p-3.5 min-h-[72px] rounded-2xl border flex flex-col items-center justify-center gap-1.5 sm:gap-2 text-center transition-all ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-600 text-blue-600 dark:text-blue-400 font-bold shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] sm:text-xs leading-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Privacy & Contact Lookup Controls */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-500" />
            <span>Contact Number & Profile Privacy</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            JIT GROUP uses your contact number as your account identity key. By default, it is kept private.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">Make Contact Number Public</p>
              <p className="text-[11px] text-slate-500">Allow other students and faculty to view your phone number</p>
            </div>
            <input
              type="checkbox"
              checked={isPhonePublic}
              onChange={(e) => setIsPhonePublic(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">Make Hostel / Campus Address Public</p>
              <p className="text-[11px] text-slate-500">Display your room or campus location on your profile card</p>
            </div>
            <input
              type="checkbox"
              checked={isAddressPublic}
              onChange={(e) => setIsAddressPublic(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleSavePrivacy}
          className="px-4 py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
        >
          Save Privacy Settings
        </button>
      </section>

      {/* 3. Mandatory 180-Day Automated Account Deletion Policy */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Automated 180-Day Inactive Account Deletion
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              If a user does not log in for 180 consecutive days, their account becomes eligible for automated deletion. The backend scheduled cron job automatically purges inactive accounts and storage files without requiring manual admin approval.
            </p>

            {currentUser && (
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl text-xs space-y-1">
                <p className="text-slate-700 dark:text-slate-300">
                  Last login recorded: <strong>{new Date(currentUser.lastLoginAt || currentUser.lastLogin || currentUser.joinedAt).toLocaleString()}</strong>
                </p>
                <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Account status: Active ({daysRemaining} days until 180-day inactivity threshold)
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. Architecture & Cross-Browser Synchronization */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Cross-Browser & Multi-Device Cloud Sync Active
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Your registered profile and virtual points are accessible across all mobile devices, tablets, and desktop browsers via the shared backend server. Inactive accounts exceeding 180 consecutive days without login are automatically purged by scheduled maintenance.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Account Switch & Logout */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Account Session</h3>
          <p className="text-xs text-slate-500">
            Switch profile or sign in with another registered contact number.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onOpenAuth}
            className="flex-1 sm:flex-initial px-4 py-2.5 min-h-[44px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            Switch Profile
          </button>
          <button
            onClick={logout}
            className="flex-1 sm:flex-initial px-4 py-2.5 min-h-[44px] bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </section>

      {/* 6. Permanent Account Deletion */}
      {currentUser && (
        <section className="bg-white dark:bg-slate-900 border border-red-200/80 dark:border-red-900/50 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Permanent Account Deletion</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isProtectedDemoAccount
                ? 'Built-in campus demo profiles are protected and cannot be permanently deleted.'
                : 'Permanently delete your JIT GROUP profile, saved login entry, and cloud records from Firebase.'}
            </p>
          </div>

          <button
            type="button"
            disabled={isProtectedDemoAccount}
            onClick={() => {
              setDeleteError('');
              setShowDeleteConfirm(true);
            }}
            className="px-4 py-2.5 min-h-[44px] bg-red-600 hover:bg-red-700 disabled:opacity-45 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Account</span>
          </button>
        </section>
      )}

      {/* Permanent Account Deletion Confirmation Modal */}
      {showDeleteConfirm && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Delete Account Permanently?
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {currentUser.fullName} · {currentUser.contactNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This will permanently remove your profile, points, and phone login index from JIT GROUP and sign you out immediately. This action cannot be undone.
            </p>

            {deleteError && (
              <p className="text-xs text-red-600 dark:text-red-400 font-semibold">
                {deleteError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingAccount}
                onClick={handleConfirmDeleteAccount}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
              >
                {deletingAccount ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
