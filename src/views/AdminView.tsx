/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { UserProfile } from '../types';
import { APP_CONFIG } from '../constants/branding';
import {
  auth,
  fetchAllCloudProfilesAsAdmin,
  signInAdminWithGoogle,
  signOutAdminGoogle,
} from '../lib/firebase';
import {
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  RefreshCw,
  Search,
  Download,
  KeyRound,
  LogOut,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Users,
  Sparkles,
  Clock,
  Phone,
  Calendar,
  X,
} from 'lucide-react';

interface AdminUserRecord extends UserProfile {
  source?: 'firebase' | 'local-mirror';
}

interface AdminViewProps {
  onExitAdmin: () => void;
}

type SortOption = 'joined_desc' | 'login_desc' | 'points_desc' | 'name_asc';
type ActivityFilter = 'all' | 'active_30d' | 'idle_30d';

const ADMIN_TOKEN_KEY = 'jit_admin_session_token';
const ADMIN_EXPIRY_KEY = 'jit_admin_session_expiry';
const INACTIVITY_DAYS_LIMIT = 180;

function formatDateTime(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return { date: '—', time: '' };
  return {
    date: parsed.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }),
    time: parsed.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function getDaysSince(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
}

function getDaysRemaining(profile: UserProfile): number {
  if (profile.id === 'usr_jit_primary_001') return INACTIVITY_DAYS_LIMIT;
  const days = getDaysSince(profile.lastLoginAt || profile.lastLogin || profile.joinedAt);
  return Math.max(0, INACTIVITY_DAYS_LIMIT - days);
}

export const AdminView: React.FC<AdminViewProps> = ({ onExitAdmin }) => {
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = sessionStorage.getItem(ADMIN_TOKEN_KEY);
      const exp = Number(sessionStorage.getItem(ADMIN_EXPIRY_KEY) || 0);
      if (saved && exp > Date.now()) {
        return saved;
      }
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_EXPIRY_KEY);
    } catch {
      // Ignore storage failures
    }
    return null;
  });

  const [verifyingSession, setVerifyingSession] = useState<boolean>(() => Boolean(adminToken));
  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [submittingPin, setSubmittingPin] = useState(false);

  // Dashboard data state
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('');
  const [firebaseCount, setFirebaseCount] = useState<number>(0);

  // Google Admin direct Firestore sync status (optional extra layer)
  const [googleAdminEmail, setGoogleAdminEmail] = useState<string | null>(
    () => auth.currentUser?.email || null
  );
  const [googleAuthBusy, setGoogleAuthBusy] = useState(false);
  const [googleStatusNote, setGoogleStatusNote] = useState('');

  // Filtering & sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('login_desc');

  // Custom PIN modal
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [currentPinField, setCurrentPinField] = useState('');
  const [newPinField, setNewPinField] = useState('');
  const [confirmPinField, setConfirmPinField] = useState('');
  const [pinChangeMsg, setPinChangeMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingPin, setSavingPin] = useState(false);

  const clearSession = useCallback(() => {
    setAdminToken(null);
    setUsers([]);
    setLastSyncedAt('');
    setLoadError('');
    try {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      sessionStorage.removeItem(ADMIN_EXPIRY_KEY);
    } catch {
      // Ignore
    }
  }, []);

  // Validate stored token with server on mount
  useEffect(() => {
    if (!adminToken) {
      setVerifyingSession(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/session', {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (!active) return;
        if (!res.ok) {
          clearSession();
        }
      } catch {
        if (active) clearSession();
      } finally {
        if (active) setVerifyingSession(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [adminToken, clearSession]);

  const fetchAdminUsers = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride || adminToken;
      if (!token) return;

      setLoadingUsers(true);
      setLoadError('');

      try {
        const res = await fetch('/api/admin/users', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.status === 401) {
          clearSession();
          setAuthError('Administrator session expired. Please enter your PIN again.');
          return;
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
          setLoadError(data.error || 'Unable to load Firebase user directory.');
          return;
        }

        const mergedMap = new Map<string, AdminUserRecord>();
        const serverUsers: AdminUserRecord[] = Array.isArray(data.users) ? data.users : [];
        for (const u of serverUsers) {
          mergedMap.set(u.id, u);
        }

        let directFirebaseUsers = 0;
        if (auth.currentUser?.email) {
          try {
            const directList = await fetchAllCloudProfilesAsAdmin();
            for (const cu of directList) {
              mergedMap.set(cu.id, { ...cu, source: 'firebase' });
              directFirebaseUsers++;
            }
          } catch {
            // Non-fatal if client auth user isn't the Firestore admin email
          }
        }

        setUsers(Array.from(mergedMap.values()));
        setFirebaseCount(Math.max(Number(data.firebaseCount || 0), directFirebaseUsers));
        setLastSyncedAt(data.syncedAt || new Date().toISOString());
      } catch {
        setLoadError('Network error while connecting to Firebase directory.');
      } finally {
        setLoadingUsers(false);
      }
    },
    [adminToken, clearSession]
  );

  useEffect(() => {
    if (adminToken && !verifyingSession) {
      fetchAdminUsers(adminToken);
    }
  }, [adminToken, verifyingSession, fetchAdminUsers]);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) {
      setAuthError('Please enter the administrator PIN.');
      return;
    }

    setSubmittingPin(true);
    setAuthError('');

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await res.json();

      if (!res.ok || !data.success || !data.token) {
        setAuthError(data.error || 'Access denied. Invalid administrator PIN.');
        return;
      }

      try {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
        sessionStorage.setItem(ADMIN_EXPIRY_KEY, String(data.expiresAt || Date.now() + 3600_000));
      } catch {
        // Ignore storage restrictions
      }

      setPinInput('');
      setAdminToken(data.token);
    } catch {
      setAuthError('Unable to reach verification server. Please try again.');
    } finally {
      setSubmittingPin(false);
    }
  };

  const handleGoogleAdminConnect = async () => {
    setGoogleAuthBusy(true);
    setGoogleStatusNote('');
    try {
      const info = await signInAdminWithGoogle();
      setGoogleAdminEmail(info.email);
      setGoogleStatusNote(
        info.email
          ? `Connected as ${info.email}. Refreshing direct Firestore records.`
          : 'Google account connected.'
      );
      await fetchAdminUsers();
    } catch (err: any) {
      setGoogleStatusNote(err?.message || 'Google Admin verification was cancelled.');
    } finally {
      setGoogleAuthBusy(false);
    }
  };

  const handleGoogleAdminDisconnect = async () => {
    setGoogleAuthBusy(true);
    try {
      await signOutAdminGoogle();
      setGoogleAdminEmail(null);
      setGoogleStatusNote('');
    } finally {
      setGoogleAuthBusy(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setPinChangeMsg(null);

    if (newPinField.trim().length < 4) {
      setPinChangeMsg({ type: 'err', text: 'New PIN must be at least 4 characters.' });
      return;
    }
    if (newPinField !== confirmPinField) {
      setPinChangeMsg({ type: 'err', text: 'New PIN and confirmation do not match.' });
      return;
    }

    setSavingPin(true);
    try {
      const res = await fetch('/api/admin/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          currentPin: currentPinField,
          newPin: newPinField,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPinChangeMsg({ type: 'err', text: data.error || 'Failed to update PIN.' });
        return;
      }

      if (data.token) {
        try {
          sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
          sessionStorage.setItem(ADMIN_EXPIRY_KEY, String(data.expiresAt || Date.now() + 3600_000));
        } catch {
          // Ignore
        }
        setAdminToken(data.token);
      }

      setCurrentPinField('');
      setNewPinField('');
      setConfirmPinField('');
      setPinChangeMsg({ type: 'ok', text: 'Custom administrator PIN saved.' });
    } catch {
      setPinChangeMsg({ type: 'err', text: 'Server error while saving new PIN.' });
    } finally {
      setSavingPin(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = users.filter((u) => {
      if (q) {
        const matchesName = (u.fullName || '').toLowerCase().includes(q);
        const matchesPhone = (u.contactNumber || '').toLowerCase().includes(q);
        const matchesId = (u.id || '').toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesId) return false;
      }
      if (activityFilter !== 'all') {
        const idleDays = getDaysSince(u.lastLoginAt || u.lastLogin || u.joinedAt);
        if (activityFilter === 'active_30d' && idleDays > 30) return false;
        if (activityFilter === 'idle_30d' && idleDays <= 30) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'points_desc') {
        return (b.stats?.rewardPoints ?? 0) - (a.stats?.rewardPoints ?? 0);
      }
      if (sortBy === 'name_asc') {
        return (a.fullName || '').localeCompare(b.fullName || '');
      }
      if (sortBy === 'joined_desc') {
        return new Date(b.joinedAt || 0).getTime() - new Date(a.joinedAt || 0).getTime();
      }
      const aLogin = new Date(a.lastLoginAt || a.lastLogin || a.joinedAt || 0).getTime();
      const bLogin = new Date(b.lastLoginAt || b.lastLogin || b.joinedAt || 0).getTime();
      return bLogin - aLogin;
    });

    return list;
  }, [users, searchQuery, activityFilter, sortBy]);

  const metrics = useMemo(() => {
    const totalPoints = users.reduce((sum, u) => sum + (u.stats?.rewardPoints ?? 0), 0);
    const active30d = users.filter(
      (u) => getDaysSince(u.lastLoginAt || u.lastLogin || u.joinedAt) <= 30
    ).length;
    const expiringSoon = users.filter((u) => getDaysRemaining(u) <= 30).length;
    return {
      totalUsers: users.length,
      active30d,
      totalPoints,
      expiringSoon,
    };
  }, [users]);

  const handleExportCsv = () => {
    if (filteredUsers.length === 0) return;
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
    const headers = [
      'User ID',
      'Full Name',
      'Phone Number',
      'Account Created',
      'Last Login',
      'JIT Points',
      'Games Played',
      'Games Won',
      'Days Until Expiry',
    ];
    const rows = filteredUsers.map((u) => [
      escapeCsv(u.id),
      escapeCsv(u.fullName),
      escapeCsv(u.contactNumber),
      escapeCsv(u.joinedAt),
      escapeCsv(u.lastLoginAt || u.lastLogin || u.joinedAt),
      escapeCsv(u.stats?.rewardPoints ?? 0),
      escapeCsv(u.stats?.gamesPlayed ?? 0),
      escapeCsv(u.stats?.gamesWon ?? 0),
      escapeCsv(getDaysRemaining(u)),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jit-group-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --------------------------------------------------------------------------
  // PIN Gate Screen (Displayed whenever locked; normal users cannot bypass)
  // --------------------------------------------------------------------------
  if (verifyingSession || !adminToken) {
    return (
      <div className="min-h-[calc(100dvh-110px)] flex items-center justify-center px-3 py-6">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                  Administrator Access
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Protected Firebase User Directory
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-w-[44px] min-h-[44px] px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit</span>
            </button>
          </div>

          {verifyingSession ? (
            <div className="py-10 text-center text-xs text-slate-500">
              Verifying administrator session...
            </div>
          ) : (
            <form onSubmit={handleUnlockSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="admin-pin-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Administrator PIN
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    id="admin-pin-input"
                    type={showPin ? 'text' : 'password'}
                    autoFocus
                    autoComplete="current-password"
                    required
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="Enter administrator PIN"
                    className="w-full min-h-[44px] pl-10 pr-12 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-900 dark:text-white font-mono tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                    aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  >
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Only authorized administrators with a valid PIN can view registered Firebase user accounts.
                </p>
              </div>

              {authError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={submittingPin}
                  className="flex-1 min-h-[44px] px-4 py-2.5 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  {submittingPin ? 'Verifying PIN...' : 'Unlock Dashboard'}
                </button>
                <button
                  type="button"
                  onClick={onExitAdmin}
                  className="min-h-[44px] px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  Return to App
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Unlocked Admin Dashboard (Clean Single-Elevation Directory)
  // --------------------------------------------------------------------------
  const lastSyncFormatted = formatDateTime(lastSyncedAt);

  return (
    <div className="w-full space-y-5">
      {/* Top Bar Contract */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{APP_CONFIG.name}</span>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">Admin Directory</span>
            {lastSyncedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Synced {lastSyncFormatted.time || lastSyncFormatted.date}
                </span>
              </>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight mt-1">
            Firebase User Accounts
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Live directory of registered user profiles, contact numbers, login timestamps, and JIT Points.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchAdminUsers()}
            disabled={loadingUsers}
            className="min-h-[44px] px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
            <span>Refresh Firebase</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPinChangeMsg(null);
              setIsPinModalOpen(true);
            }}
            className="min-h-[44px] px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Change PIN</span>
          </button>

          <button
            type="button"
            onClick={() => {
              clearSession();
              onExitAdmin();
            }}
            className="min-h-[44px] px-3.5 py-2 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Lock & Exit</span>
          </button>
        </div>
      </div>

      {/* 4-Column Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Firebase Users</span>
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {metrics.totalUsers}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {firebaseCount} synced from Firestore
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Active Within 30d</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {metrics.active30d}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Recent logins preserved
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total JIT Points</span>
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {metrics.totalPoints.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Combined wallet balances
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Expiring Soon</span>
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {metrics.expiringSoon}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Within 30d of 180d limit
          </p>
        </div>
      </div>

      {/* Optional Direct Firestore Google Admin Verification Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
          <div className="min-w-0 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {googleAdminEmail
                ? `Firestore Admin Auth Active: ${googleAdminEmail}`
                : 'Direct Firestore Rule Verification (Optional)'}
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {googleStatusNote ||
                'Sign in with the verified admin Google account to also run direct client-side Firestore collection queries.'}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {googleAdminEmail ? (
            <button
              type="button"
              onClick={handleGoogleAdminDisconnect}
              disabled={googleAuthBusy}
              className="min-h-[40px] px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
            >
              Disconnect Google
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGoogleAdminConnect}
              disabled={googleAuthBusy}
              className="min-h-[40px] px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
            >
              {googleAuthBusy ? 'Connecting...' : 'Verify Google Admin'}
            </button>
          )}
        </div>
      </div>

      {/* Filter, Search & Export Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by user name, phone number, or ID..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Activity Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'active_30d', label: 'Active 30d' },
                  { id: 'idle_30d', label: 'Idle 30d+' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActivityFilter(tab.id)}
                  className={`px-3 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    activityFilter === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sort Selector */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Sort users"
              className="min-h-[44px] px-3 py-2 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="login_desc">Last Login (Newest)</option>
              <option value="joined_desc">Created Date (Newest)</option>
              <option value="points_desc">JIT Points (Highest)</option>
              <option value="name_asc">Name (A–Z)</option>
            </select>

            {/* CSV Export */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredUsers.length === 0}
              className="min-h-[44px] px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Error State */}
        {loadError && (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-700 dark:text-red-300">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loadError}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchAdminUsers()}
              className="min-h-[38px] px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton State */}
        {loadingUsers && users.length === 0 ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="h-12 bg-slate-100 dark:bg-slate-800/70 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <Users className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No matching user accounts found
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Adjust your search query or refresh directly from Firebase.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActivityFilter('all');
                fetchAdminUsers();
              }}
              className="min-h-[40px] px-4 py-2 bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold rounded-xl"
            >
              Reset Filters & Refresh
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Data Table */}
            <div className="hidden md:block overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Phone Number</th>
                    <th className="py-3 px-4">Account Created</th>
                    <th className="py-3 px-4">Last Login</th>
                    <th className="py-3 px-4 text-right">JIT Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {filteredUsers.map((u) => {
                    const created = formatDateTime(u.joinedAt);
                    const lastLogin = formatDateTime(u.lastLoginAt || u.lastLogin || u.joinedAt);
                    const daysLeft = getDaysRemaining(u);
                    return (
                      <tr
                        key={u.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={u.avatarUrl || APP_CONFIG.logoUrl}
                              alt={u.fullName}
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).src = APP_CONFIG.logoUrl;
                              }}
                              className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                            />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
                                {u.fullName}
                              </p>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[220px]">
                                <span className="truncate">{u.id}</span>
                                <span aria-hidden="true">·</span>
                                <span>{u.source === 'local-mirror' ? 'Local' : 'Firebase'}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {u.contactNumber || '—'}
                        </td>

                        <td className="py-3 px-4 tabular-nums whitespace-nowrap">
                          <span className="text-slate-800 dark:text-slate-200 font-medium">
                            {created.date}
                          </span>
                          {created.time && (
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                              {created.time}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 tabular-nums whitespace-nowrap">
                          <span className="text-slate-800 dark:text-slate-200 font-medium">
                            {lastLogin.date}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {lastLogin.time ? `${lastLogin.time} · ` : ''}
                            {daysLeft}d left
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          <span className="text-sm font-bold text-slate-900 dark:text-white font-mono">
                            {(u.stats?.rewardPoints ?? 0).toLocaleString()}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {u.stats?.gamesWon ?? 0}W / {u.stats?.gamesPlayed ?? 0}P
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Directory List */}
            <div className="md:hidden divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {filteredUsers.map((u) => {
                const created = formatDateTime(u.joinedAt);
                const lastLogin = formatDateTime(u.lastLoginAt || u.lastLogin || u.joinedAt);
                const daysLeft = getDaysRemaining(u);
                return (
                  <div key={u.id} className="p-4 space-y-3 bg-white dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={u.avatarUrl || APP_CONFIG.logoUrl}
                          alt={u.fullName}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = APP_CONFIG.logoUrl;
                          }}
                          className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {u.fullName}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                            {u.id}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                          {(u.stats?.rewardPoints ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">JIT Points</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                          <Phone className="w-3.5 h-3.5" />
                          <span>Phone</span>
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                          {u.contactNumber || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Created</span>
                        </span>
                        <span className="font-mono tabular-nums">
                          {created.date} {created.time}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Last Login</span>
                        </span>
                        <span className="font-mono tabular-nums">
                          {lastLogin.date} {lastLogin.time} · {daysLeft}d left
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              <span className="font-mono tabular-nums">
                Showing {filteredUsers.length} of {users.length} accounts
              </span>
              <span>180-day inactivity retention policy active</span>
            </div>
          </>
        )}
      </div>

      {/* Custom Admin PIN Modal */}
      {isPinModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Update Administrator PIN
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Replace the default PIN with a custom administrator password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPinModalOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleChangePin} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Current PIN
                </label>
                <input
                  type="password"
                  required
                  value={currentPinField}
                  onChange={(e) => setCurrentPinField(e.target.value)}
                  placeholder="Enter current PIN"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  New Custom PIN
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={newPinField}
                  onChange={(e) => setNewPinField(e.target.value)}
                  placeholder="Minimum 4 characters"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Confirm New PIN
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={confirmPinField}
                  onChange={(e) => setConfirmPinField(e.target.value)}
                  placeholder="Re-enter new PIN"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono"
                />
              </div>

              {pinChangeMsg && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                    pinChangeMsg.type === 'ok'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
                  }`}
                >
                  {pinChangeMsg.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{pinChangeMsg.text}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPinModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPin}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 rounded-xl disabled:opacity-60"
                >
                  {savingPin ? 'Saving...' : 'Save Custom PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
