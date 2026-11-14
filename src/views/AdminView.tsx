/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { UserProfile, GlobalAnnouncement, Conversation, Message, Post, MatchHistoryRecord } from '../types';
import { APP_CONFIG } from '../constants/branding';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { saveCompressedProfileMediaFile, validateMediaFile } from '../services/mediaStorage';
import {
  auth,
  fetchAllCloudProfilesAsAdmin,
  deleteCloudProfileAsAdmin,
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
  Activity,
  FileText,
  MessageSquare,
  Clock,
  Phone,
  Calendar,
  X,
  Megaphone,
  Trash2,
  Ban,
  RotateCcw,
  Save,
  Upload,
  Sparkles,
  Trophy,
  ChevronRight,
  Send,
  ShieldAlert,
} from 'lucide-react';

interface AdminUserRecord extends UserProfile {
  source?: 'firebase' | 'local-mirror';
}

interface PlatformAnalytics {
  totalUsers: number;
  dailyActiveUsers: number;
  totalPosts: number;
  activeChatThreads: number;
  totalMessages?: number;
  activeAnnouncements?: number;
}

interface UserActivityPayload {
  user: AdminUserRecord;
  conversations: Conversation[];
  messages: Array<Message & { timestampIso?: string }>;
  inGameMessages: Array<{
    id: string;
    roomCode: string;
    gameId: string;
    senderId: string;
    senderName: string;
    text?: string;
    imageUrl?: string;
    timestamp: string;
  }>;
  posts: Post[];
  matchHistory: MatchHistoryRecord[];
}

interface AdminViewProps {
  onExitAdmin: () => void;
}

type SortOption = 'joined_desc' | 'login_desc' | 'points_desc' | 'name_asc';
type StatusFilter = 'all' | 'active' | 'suspended' | 'idle_30d';
type InspectorTab = 'overview' | 'chats' | 'activity' | 'moderation';

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
  const { syncServerProfiles } = useAuth();
  const { refreshAnnouncements } = useSocial();

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
  const [analytics, setAnalytics] = useState<PlatformAnalytics>({
    totalUsers: 0,
    dailyActiveUsers: 0,
    totalPosts: 0,
    activeChatThreads: 0,
  });
  const [announcements, setAnnouncements] = useState<GlobalAnnouncement[]>([]);
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('login_desc');

  // Custom PIN modal
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [currentPinField, setCurrentPinField] = useState('');
  const [newPinField, setNewPinField] = useState('');
  const [confirmPinField, setConfirmPinField] = useState('');
  const [pinChangeMsg, setPinChangeMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingPin, setSavingPin] = useState(false);

  // Global Announcement Broadcaster modal/panel
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annMessage, setAnnMessage] = useState('');
  const [annPriority, setAnnPriority] = useState<'important' | 'info' | 'event'>('important');
  const [annPostToFeed, setAnnPostToFeed] = useState(true);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // User Inspection Drawer state
  const [inspectedUser, setInspectedUser] = useState<AdminUserRecord | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [activityData, setActivityData] = useState<UserActivityPayload | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('all');

  // Admin Profile Override form state
  const [editFullName, setEditFullName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [editPoints, setEditPoints] = useState<string>('0');
  const [savingEdits, setSavingEdits] = useState(false);
  const [editFeedback, setEditFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Admin Moderation state
  const [suspendReason, setSuspendReason] = useState('');
  const [confirmDeleteStep, setConfirmDeleteStep] = useState(false);
  const [moderatingBusy, setModeratingBusy] = useState(false);
  const [moderationFeedback, setModerationFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const clearSession = useCallback(() => {
    setAdminToken(null);
    setUsers([]);
    setAnnouncements([]);
    setInspectedUser(null);
    setActivityData(null);
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
        const [usersRes, annRes] = await Promise.all([
          fetch('/api/admin/users', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/admin/announcements', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (usersRes.status === 401 || annRes.status === 401) {
          clearSession();
          setAuthError('Administrator session expired. Please enter your PIN again.');
          return;
        }

        const data = await usersRes.json();
        if (!usersRes.ok || !data.success) {
          setLoadError(data.error || 'Unable to load Firebase user directory.');
          return;
        }

        if (annRes.ok) {
          const annData = await annRes.json();
          if (Array.isArray(annData.announcements)) {
            setAnnouncements(annData.announcements);
          }
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

        const finalList = Array.from(mergedMap.values());
        setUsers(finalList);
        setFirebaseCount(Math.max(Number(data.firebaseCount || 0), directFirebaseUsers));
        if (data.analytics) {
          setAnalytics({
            ...data.analytics,
            totalUsers: Math.max(Number(data.analytics.totalUsers || 0), finalList.length),
          });
        } else {
          setAnalytics((prev) => ({ ...prev, totalUsers: finalList.length }));
        }
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

  const populateEditForm = useCallback((user: AdminUserRecord) => {
    setEditFullName(user.fullName || '');
    setEditBio(user.bio || '');
    setEditAvatarUrl(user.avatarUrl || '/assets/aistudio/image_e64e54f2.png');
    setEditCoverUrl(user.coverUrl || '');
    setEditPoints(String(user.stats?.rewardPoints ?? 0));
    setSuspendReason(user.suspendedReason || '');
    setConfirmDeleteStep(false);
    setEditFeedback(null);
    setModerationFeedback(null);
  }, []);

  const openUserInspector = useCallback(
    async (user: AdminUserRecord, initialTab: InspectorTab = 'overview') => {
      if (!adminToken) return;
      setInspectedUser(user);
      setInspectorTab(initialTab);
      setSelectedThreadId('all');
      populateEditForm(user);
      setActivityError('');
      setLoadingActivity(true);

      try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/activity`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (res.status === 401) {
          clearSession();
          return;
        }
        const data = await res.json();
        if (!res.ok || !data.success) {
          setActivityError(data.error || 'Failed to load user activity logs.');
          setActivityData({
            user,
            conversations: [],
            messages: [],
            inGameMessages: [],
            posts: [],
            matchHistory: [],
          });
          return;
        }
        setActivityData(data);
        if (data.user) {
          setInspectedUser(data.user);
          populateEditForm(data.user);
        }
      } catch {
        setActivityError('Network error loading user chat and activity logs.');
      } finally {
        setLoadingActivity(false);
      }
    },
    [adminToken, clearSession, populateEditForm]
  );

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

  const handleImagePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: 'avatar' | 'cover'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateMediaFile(file, { allowedCategory: 'image', maxSizeMb: 12 });
    if (!validation.valid) {
      setEditFeedback({ type: 'err', text: validation.error || 'Invalid image file.' });
      return;
    }
    try {
      const { dataUrl } = await saveCompressedProfileMediaFile(file, mode);
      if (mode === 'avatar') {
        setEditAvatarUrl(dataUrl);
      } else {
        setEditCoverUrl(dataUrl);
      }
      setEditFeedback(null);
    } catch {
      setEditFeedback({ type: 'err', text: 'Could not process image file.' });
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveUserEdits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !inspectedUser) return;
    setEditFeedback(null);

    const parsedPoints = Number(editPoints);
    if (isNaN(parsedPoints) || parsedPoints < 0 || parsedPoints > 1000000) {
      setEditFeedback({ type: 'err', text: 'JIT Points must be between 0 and 1,000,000.' });
      return;
    }

    setSavingEdits(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(inspectedUser.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          fullName: editFullName.trim(),
          bio: editBio,
          avatarUrl: editAvatarUrl.trim() || '/assets/aistudio/image_e64e54f2.png',
          coverUrl: editCoverUrl.trim(),
          rewardPoints: Math.floor(parsedPoints),
        }),
      });

      if (res.status === 401) {
        clearSession();
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success || !data.user) {
        setEditFeedback({ type: 'err', text: data.error || 'Failed to save user overrides.' });
        return;
      }

      const updated: AdminUserRecord = { ...data.user, source: inspectedUser.source || 'firebase' };
      setInspectedUser(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditFeedback({ type: 'ok', text: 'User profile and JIT Points saved to Firebase.' });
      syncServerProfiles().catch(() => {});
    } catch {
      setEditFeedback({ type: 'err', text: 'Network error while saving profile overrides.' });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleModerateUser = async (action: 'suspend' | 'unblock' | 'delete') => {
    if (!adminToken || !inspectedUser) return;
    setModeratingBusy(true);
    setModerationFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(inspectedUser.id)}/moderate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          action,
          reason: suspendReason.trim() || undefined,
        }),
      });

      if (res.status === 401) {
        clearSession();
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        setModerationFeedback({ type: 'err', text: data.error || 'Moderation action failed.' });
        return;
      }

      if (action === 'delete') {
        if (auth.currentUser?.email) {
          deleteCloudProfileAsAdmin(inspectedUser).catch(() => {});
        }
        setUsers((prev) => prev.filter((u) => u.id !== inspectedUser.id));
        setAnalytics((prev) => ({ ...prev, totalUsers: Math.max(0, prev.totalUsers - 1) }));
        setInspectedUser(null);
        setActivityData(null);
        syncServerProfiles().catch(() => {});
        return;
      }

      const updated: AdminUserRecord = { ...data.user, source: inspectedUser.source || 'firebase' };
      setInspectedUser(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setModerationFeedback({
        type: 'ok',
        text:
          action === 'suspend'
            ? 'Account suspended. User cannot log in or update data until unblocked.'
            : 'Account unblocked and restored to active status.',
      });
      syncServerProfiles().catch(() => {});
    } catch {
      setModerationFeedback({ type: 'err', text: 'Network error applying moderation action.' });
    } finally {
      setModeratingBusy(false);
    }
  };

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !annTitle.trim() || !annMessage.trim()) return;
    setSendingBroadcast(true);
    setBroadcastFeedback(null);

    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          title: annTitle.trim(),
          message: annMessage.trim(),
          priority: annPriority,
          alsoPostToFeed: annPostToFeed,
        }),
      });

      if (res.status === 401) {
        clearSession();
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        setBroadcastFeedback({ type: 'err', text: data.error || 'Failed to publish announcement.' });
        return;
      }

      if (Array.isArray(data.announcements)) {
        setAnnouncements(data.announcements);
      }
      setAnnTitle('');
      setAnnMessage('');
      setBroadcastFeedback({ type: 'ok', text: 'Site-wide announcement broadcasted to all user feeds.' });
      refreshAnnouncements().catch(() => {});
      fetchAdminUsers().catch(() => {});
    } catch {
      setBroadcastFeedback({ type: 'err', text: 'Network error publishing announcement.' });
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`/api/admin/announcements/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.announcements)) {
          setAnnouncements(data.announcements);
        } else {
          setAnnouncements((prev) => prev.filter((a) => a.id !== id));
        }
        refreshAnnouncements().catch(() => {});
        fetchAdminUsers().catch(() => {});
      }
    } catch {
      // Ignore
    }
  };

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = users.filter((u) => {
      if (u.status === 'deleted') return false;
      if (q) {
        const matchesName = (u.fullName || '').toLowerCase().includes(q);
        const matchesPhone = (u.contactNumber || '').toLowerCase().includes(q);
        const matchesId = (u.id || '').toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesId) return false;
      }
      if (statusFilter === 'active' && u.status === 'suspended') return false;
      if (statusFilter === 'suspended' && u.status !== 'suspended') return false;
      if (statusFilter === 'idle_30d') {
        const idleDays = getDaysSince(u.lastLoginAt || u.lastLogin || u.joinedAt);
        if (idleDays <= 30) return false;
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
  }, [users, searchQuery, statusFilter, sortBy]);

  const handleExportCsv = () => {
    if (filteredUsers.length === 0) return;
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
    const headers = [
      'User ID',
      'Full Name',
      'Phone Number',
      'Status',
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
      escapeCsv(u.status || 'active'),
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

  // Filtered messages inside Inspector Chat tab
  const inspectedMessages = useMemo(() => {
    if (!activityData?.messages) return [];
    if (selectedThreadId === 'all') return activityData.messages;
    return activityData.messages.filter((m) => m.conversationId === selectedThreadId);
  }, [activityData, selectedThreadId]);

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
                  Protected Platform Management Console
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
                  Only authorized administrators with a valid PIN can inspect user profiles, chat logs, and platform controls.
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
  // Unlocked Admin Console
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
            <span className="font-medium text-slate-700 dark:text-slate-200">Admin Console</span>
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
            Platform & User Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Inspect user profiles and DMs, adjust balances, moderate accounts, and broadcast site-wide notices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setBroadcastFeedback(null);
              setIsBroadcastOpen((v) => !v);
            }}
            className="min-h-[44px] px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Megaphone className="w-3.5 h-3.5" />
            <span>Global Notice</span>
          </button>

          <button
            type="button"
            onClick={() => fetchAdminUsers()}
            disabled={loadingUsers}
            className="min-h-[44px] px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
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
            className="min-h-[44px] px-3.5 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Lock & Exit</span>
          </button>
        </div>
      </div>

      {/* Platform Analytics 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Registered Users</span>
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {analytics.totalUsers}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {firebaseCount} synced from Firestore
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Daily Active Users</span>
            <Activity className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {analytics.dailyActiveUsers}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Signed in within 24 hours
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Posts</span>
            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {analytics.totalPosts}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {announcements.length} active broadcasts
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Active Chat Threads</span>
            <MessageSquare className="w-4 h-4 text-amber-600 shrink-0" />
          </div>
          <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-2">
            {analytics.activeChatThreads}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {analytics.totalMessages ?? 0} logged messages
          </p>
        </div>
      </div>

      {/* Global Announcement Broadcaster Panel */}
      {isBroadcastOpen && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <Megaphone className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Global Announcement Broadcaster
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Post site-wide notices across every user feed and top banner.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsBroadcastOpen(false)}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close broadcaster"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form onSubmit={handlePublishAnnouncement} className="lg:col-span-7 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Notice Title
                  </label>
                  <input
                    type="text"
                    required
                    value={annTitle}
                    onChange={(e) => setAnnTitle(e.target.value)}
                    placeholder="e.g. Campus Maintenance or Championship Finals"
                    className="w-full min-h-[44px] px-3.5 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={annPriority}
                    onChange={(e) => setAnnPriority(e.target.value as 'important' | 'info' | 'event')}
                    className="w-full min-h-[44px] px-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="important">Important Notice</option>
                    <option value="info">General Info</option>
                    <option value="event">Campus Event</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Broadcast Message
                </label>
                <textarea
                  rows={3}
                  required
                  value={annMessage}
                  onChange={(e) => setAnnMessage(e.target.value)}
                  placeholder="Write the official notice to display to all registered members..."
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={annPostToFeed}
                  onChange={(e) => setAnnPostToFeed(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-600"
                />
                <span>Also publish as an Official Notice post in every user's Home Feed</span>
              </label>

              {broadcastFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                    broadcastFeedback.type === 'ok'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
                  }`}
                >
                  {broadcastFeedback.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{broadcastFeedback.text}</span>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sendingBroadcast || !annTitle.trim() || !annMessage.trim()}
                  className="min-h-[44px] px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingBroadcast ? 'Broadcasting...' : 'Broadcast to All Feeds'}</span>
                </button>
              </div>
            </form>

            {/* Active Announcements List */}
            <div className="lg:col-span-5 border-t lg:border-t-0 lg:border-l border-slate-100 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-5 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>Active Site-Wide Notices</span>
                <span className="font-mono tabular-nums text-slate-500">{announcements.length}</span>
              </div>

              {announcements.length === 0 ? (
                <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                  No active announcements. Use the form to broadcast a site-wide notice.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {announcements.map((ann) => {
                    const ts = formatDateTime(ann.createdAt);
                    return (
                      <div
                        key={ann.id}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {ann.title}
                          </p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
                            {ann.message}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono tabular-nums mt-1">
                            {ann.priority.toUpperCase()} · {ts.date} {ts.time}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAnnouncement(ann.id)}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg shrink-0"
                          title="Remove announcement"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

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
                'Sign in with the verified admin Google account to also run direct client-side Firestore deletions and queries.'}
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

      {/* Filter, Search & User Directory */}
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
            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-x-auto max-w-full">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'Active' },
                  { id: 'suspended', label: 'Suspended' },
                  { id: 'idle_30d', label: 'Idle 30d+' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 min-h-[36px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    statusFilter === tab.id
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
                setStatusFilter('all');
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
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Account Created</th>
                    <th className="py-3 px-4">Last Login</th>
                    <th className="py-3 px-4 text-right">JIT Points</th>
                    <th className="py-3 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {filteredUsers.map((u) => {
                    const created = formatDateTime(u.joinedAt);
                    const lastLogin = formatDateTime(u.lastLoginAt || u.lastLogin || u.joinedAt);
                    const daysLeft = getDaysRemaining(u);
                    const isSuspended = u.status === 'suspended';
                    return (
                      <tr
                        key={u.id}
                        onClick={() => openUserInspector(u)}
                        className="hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
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
                              <p className="font-semibold text-slate-900 dark:text-white truncate max-w-[180px]">
                                {u.fullName}
                              </p>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[200px]">
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

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isSuspended ? 'bg-red-500' : 'bg-emerald-500'
                              }`}
                            />
                            <span
                              className={
                                isSuspended
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-slate-700 dark:text-slate-300'
                              }
                            >
                              {isSuspended ? 'Suspended' : 'Active'}
                            </span>
                          </span>
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

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openUserInspector(u);
                            }}
                            className="min-h-[36px] px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
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
                const isSuspended = u.status === 'suspended';
                return (
                  <div
                    key={u.id}
                    onClick={() => openUserInspector(u)}
                    className="p-4 space-y-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
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
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isSuspended ? 'bg-red-500' : 'bg-emerald-500'
                                }`}
                              />
                              <span>{isSuspended ? 'Suspended' : 'Active'}</span>
                            </span>
                            <span className="font-mono truncate">{u.id}</span>
                          </div>
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

                    <div className="pt-1 flex justify-end">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                        <span>Inspect Profile & Chats</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              <span className="font-mono tabular-nums">
                Showing {filteredUsers.length} of {users.length} accounts · Click any user to inspect & manage
              </span>
              <span>180-day inactivity retention policy active</span>
            </div>
          </>
        )}
      </div>

      {/* =====================================================================
          User Inspection, Chat Activity, Profile Editor & Moderation Drawer
      ===================================================================== */}
      {inspectedUser && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex justify-end"
          onClick={() => setInspectedUser(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Drawer Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={inspectedUser.avatarUrl || APP_CONFIG.logoUrl}
                  alt={inspectedUser.fullName}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = APP_CONFIG.logoUrl;
                  }}
                  className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                      {inspectedUser.fullName}
                    </h2>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold shrink-0">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          inspectedUser.status === 'suspended' ? 'bg-red-500' : 'bg-emerald-500'
                        }`}
                      />
                      <span
                        className={
                          inspectedUser.status === 'suspended'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {inspectedUser.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                    {inspectedUser.contactNumber} · {inspectedUser.id}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInspectedUser(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                aria-label="Close user inspector"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Inspector Section Tabs */}
            <div className="px-4 sm:px-5 pt-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
              {(
                [
                  { id: 'overview', label: 'Profile & Edit' },
                  {
                    id: 'chats',
                    label: `Chat & DMs (${
                      (activityData?.messages?.length || 0) +
                      (activityData?.inGameMessages?.length || 0)
                    })`,
                  },
                  {
                    id: 'activity',
                    label: `Posts & Games (${
                      (activityData?.posts?.length || 0) +
                      (activityData?.matchHistory?.length || 0)
                    })`,
                  },
                  { id: 'moderation', label: 'Moderation' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setInspectorTab(t.id)}
                  className={`min-h-[40px] px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    inspectorTab === t.id
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Drawer Scroll Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {activityError && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{activityError}</span>
                </div>
              )}

              {/* TAB 1: Profile Overview & Direct Admin Overrides */}
              {inspectorTab === 'overview' && (
                <div className="space-y-5">
                  {/* Cover & Avatar Live Preview */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50 dark:bg-slate-800/40">
                    <div className="h-32 sm:h-40 w-full bg-slate-200 dark:bg-slate-800 relative">
                      {editCoverUrl ? (
                        <img
                          src={editCoverUrl}
                          alt="Cover preview"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                          No cover photo configured
                        </div>
                      )}
                    </div>
                    <div className="px-4 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3 -mt-8 relative">
                      <div className="flex items-end gap-3 min-w-0">
                        <img
                          src={editAvatarUrl || APP_CONFIG.logoUrl}
                          alt={editFullName}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = APP_CONFIG.logoUrl;
                          }}
                          className="w-16 h-16 rounded-2xl object-cover border-4 border-white dark:border-slate-900 bg-white shrink-0"
                        />
                        <div className="pt-8 min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {editFullName || inspectedUser.fullName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {inspectedUser.address || 'JIT Campus'}
                          </p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300">
                        <span className="block font-bold text-slate-900 dark:text-white">
                          {Number(editPoints || 0).toLocaleString()} JIT Points
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {inspectedUser.stats?.gamesWon ?? 0}W / {inspectedUser.stats?.gamesPlayed ?? 0}P ·{' '}
                          {getDaysRemaining(inspectedUser)}d retention left
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Direct Override Form */}
                  <form onSubmit={handleSaveUserEdits} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Display Name
                        </label>
                        <input
                          type="text"
                          required
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          JIT Points Balance
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={1000000}
                            value={editPoints}
                            onChange={(e) => setEditPoints(e.target.value)}
                            className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setEditPoints((p) => String(Math.max(0, (Number(p) || 0) - 100)))
                            }
                            className="min-h-[44px] px-2.5 text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl"
                          >
                            -100
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditPoints((p) => String(Math.min(1000000, (Number(p) || 0) + 100)))
                            }
                            className="min-h-[44px] px-2.5 text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl"
                          >
                            +100
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Bio
                      </label>
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={editBio}
                        onChange={(e) => setEditBio(e.target.value)}
                        placeholder="User bio..."
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                      />
                    </div>

                    {/* Profile Picture Override */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Profile Picture URL or Upload
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={editAvatarUrl}
                          onChange={(e) => setEditAvatarUrl(e.target.value)}
                          placeholder="https://... or upload image"
                          className="flex-1 min-h-[44px] px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImagePick(e, 'avatar')}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          className="min-h-[44px] px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shrink-0"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Photo</span>
                        </button>
                      </div>
                    </div>

                    {/* Cover Photo Override */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Cover Photo URL or Upload
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={editCoverUrl}
                          onChange={(e) => setEditCoverUrl(e.target.value)}
                          placeholder="https://... or leave empty to clear"
                          className="flex-1 min-h-[44px] px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <input
                          ref={coverInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImagePick(e, 'cover')}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => coverInputRef.current?.click()}
                          className="min-h-[44px] px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shrink-0"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Cover</span>
                        </button>
                        {editCoverUrl && (
                          <button
                            type="button"
                            onClick={() => setEditCoverUrl('')}
                            className="min-h-[44px] px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:text-red-600 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl shrink-0"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {editFeedback && (
                      <div
                        className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                          editFeedback.type === 'ok'
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {editFeedback.type === 'ok' ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span>{editFeedback.text}</span>
                      </div>
                    )}

                    <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="submit"
                        disabled={savingEdits}
                        className="min-h-[44px] px-5 py-2 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-xl flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        <span>{savingEdits ? 'Saving Overrides...' : 'Save Admin Overrides'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* TAB 2: Personal Chat Activity & DMs */}
              {inspectorTab === 'chats' && (
                <div className="space-y-5">
                  {loadingActivity ? (
                    <div className="py-10 text-center text-xs text-slate-500">
                      Loading personal chat threads & direct messages...
                    </div>
                  ) : (
                    <>
                      {/* Conversation Thread Filter Strip */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <span>Personal DMs & Group Threads</span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {activityData?.conversations?.length ?? 0} threads
                          </span>
                        </div>

                        {(activityData?.conversations?.length ?? 0) === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                            No DM or group threads recorded yet for this account.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedThreadId('all')}
                              className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
                                selectedThreadId === 'all'
                                  ? 'bg-slate-900 dark:bg-blue-600 text-white border-transparent'
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              All Threads ({activityData?.messages?.length ?? 0})
                            </button>
                            {activityData?.conversations.map((conv) => (
                              <button
                                key={conv.id}
                                type="button"
                                onClick={() => setSelectedThreadId(conv.id)}
                                className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
                                  selectedThreadId === conv.id
                                    ? 'bg-slate-900 dark:bg-blue-600 text-white border-transparent'
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                {conv.type === 'group' ? 'Group: ' : 'DM: '}
                                {conv.name || conv.id}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Message History Log */}
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Message History
                        </h3>
                        {inspectedMessages.length === 0 ? (
                          <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                            No personal messages found in selected filter.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                            {inspectedMessages.map((msg) => {
                              const conv = activityData?.conversations.find(
                                (c) => c.id === msg.conversationId
                              );
                              const isAuthor = msg.senderId === inspectedUser.id;
                              return (
                                <div
                                  key={msg.id}
                                  className="p-3.5 bg-white dark:bg-slate-900 space-y-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2 text-[11px]">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span
                                        className={`font-bold truncate ${
                                          isAuthor
                                            ? 'text-blue-600 dark:text-blue-400'
                                            : 'text-slate-800 dark:text-slate-200'
                                        }`}
                                      >
                                        {msg.senderName}
                                      </span>
                                      {conv && (
                                        <span className="text-slate-400 truncate">
                                          in {conv.name || conv.id}
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-mono tabular-nums text-slate-400 shrink-0">
                                      {msg.createdAt}
                                    </span>
                                  </div>
                                  {msg.mediaUrl && (
                                    <img
                                      src={msg.mediaUrl}
                                      alt="Chat attachment"
                                      className="max-h-36 rounded-lg object-contain border border-slate-200 dark:border-slate-700"
                                    />
                                  )}
                                  {msg.content && (
                                    <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                                      {msg.content}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Live In-Game Room Chat Messages */}
                      {(activityData?.inGameMessages?.length ?? 0) > 0 && (
                        <div className="space-y-2">
                          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Live Game Room Chat Logs
                          </h3>
                          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                            {activityData?.inGameMessages.map((gm) => (
                              <div key={gm.id} className="p-3 bg-white dark:bg-slate-900 text-xs">
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {gm.senderName} · Room #{gm.roomCode} ({gm.gameId.toUpperCase()})
                                  </span>
                                  <span className="font-mono tabular-nums">{gm.timestamp}</span>
                                </div>
                                {gm.text && (
                                  <p className="mt-1 text-slate-700 dark:text-slate-300">{gm.text}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* TAB 3: Posts & Match History */}
              {inspectorTab === 'activity' && (
                <div className="space-y-5">
                  {loadingActivity ? (
                    <div className="py-10 text-center text-xs text-slate-500">
                      Loading user posts and match history...
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          <span>Posts & Comment Activity ({activityData?.posts?.length ?? 0})</span>
                        </h3>
                        {(activityData?.posts?.length ?? 0) === 0 ? (
                          <p className="text-xs text-slate-500 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                            No posts or comments recorded for this user.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {activityData?.posts.map((p) => (
                              <div
                                key={p.id}
                                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {p.authorName}
                                  </span>
                                  <span>{p.createdAt}</span>
                                </div>
                                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line break-words">
                                  {p.content}
                                </p>
                                <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                                  {p.likesCount} likes · {p.comments?.length ?? p.commentsCount} comments
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Trophy className="w-3.5 h-3.5 text-amber-500" />
                          <span>
                            Recent Firebase Game Matches ({activityData?.matchHistory?.length ?? 0})
                          </span>
                        </h3>
                        {(activityData?.matchHistory?.length ?? 0) === 0 ? (
                          <p className="text-xs text-slate-500 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                            No match history records stored in Firestore yet.
                          </p>
                        ) : (
                          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                            {activityData?.matchHistory.map((m) => {
                              const dt = formatDateTime(m.createdAt);
                              return (
                                <div
                                  key={m.id}
                                  className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                                      {m.gameName} · {m.outcome.toUpperCase()}
                                    </p>
                                    <p className="text-[11px] text-slate-500 truncate">
                                      {m.scoreSummary}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0 font-mono tabular-nums">
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                      +{m.pointsEarned} pts
                                    </span>
                                    <span className="block text-[10px] text-slate-400">
                                      {dt.date}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB 4: User Moderation (Suspend / Unblock / Delete) */}
              {inspectorTab === 'moderation' && (
                <div className="space-y-5">
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <Ban className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {inspectedUser.status === 'suspended'
                            ? 'Account Currently Suspended'
                            : 'Suspend / Block Account'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Suspended users are immediately prevented from signing in or updating their Firebase profile until unblocked.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Moderation Reason (optional)
                      </label>
                      <input
                        type="text"
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder="e.g. Policy violation or spam activity"
                        className="w-full min-h-[44px] px-3.5 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {inspectedUser.status === 'suspended' ? (
                        <button
                          type="button"
                          disabled={moderatingBusy}
                          onClick={() => handleModerateUser('unblock')}
                          className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{moderatingBusy ? 'Restoring...' : 'Unblock & Restore Account'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={moderatingBusy}
                          onClick={() => handleModerateUser('suspend')}
                          className="min-h-[44px] px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>{moderatingBusy ? 'Suspending...' : 'Suspend / Block User'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Permanent Account Deletion */}
                  <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-bold text-red-700 dark:text-red-300">
                          Delete User Account
                        </h3>
                        <p className="text-xs text-red-600/90 dark:text-red-300/80 mt-0.5">
                          Removes the user from the active directory, clears their profile access, and purges their posts.
                        </p>
                      </div>
                    </div>

                    {!confirmDeleteStep ? (
                      <button
                        type="button"
                        disabled={moderatingBusy}
                        onClick={() => setConfirmDeleteStep(true)}
                        className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Account...</span>
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={moderatingBusy}
                          onClick={() => handleModerateUser('delete')}
                          className="min-h-[44px] px-4 py-2 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>
                            {moderatingBusy ? 'Deleting...' : `Confirm Delete ${inspectedUser.fullName}`}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={moderatingBusy}
                          onClick={() => setConfirmDeleteStep(false)}
                          className="min-h-[44px] px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {moderationFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                        moderationFeedback.type === 'ok'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
                      }`}
                    >
                      {moderationFeedback.type === 'ok' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{moderationFeedback.text}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
