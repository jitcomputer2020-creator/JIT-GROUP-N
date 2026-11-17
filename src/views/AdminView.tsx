/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  UserProfile,
  GlobalAnnouncement,
  Conversation,
  Message,
  Post,
  Reel,
  MatchHistoryRecord,
} from '../types';
import { APP_CONFIG } from '../constants/branding';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { saveCompressedProfileMediaFile, validateMediaFile } from '../services/mediaStorage';
import { ResilientVideo } from '../components/common/ResilientVideo';
import { ResponsiveImage } from '../components/common/ResponsiveImage';
import { detectExpressBackendAvailable, safeParseJsonResponse } from '../utils/safeFetch';
import {
  auth,
  fetchAllCloudProfilesAsAdmin,
  fetchGlobalLeaderboard,
  fetchMatchHistory,
  deleteCloudProfileAsAdmin,
  signInAdminWithGoogle,
  signOutAdminGoogle,
  adminOverrideCloudProfileClient,
  adminModerateCloudProfileClient,
  adminFetchUserChatActivityClient,
  adminFetchUserActivityClient,
  publishFirestorePost,
  deleteFirestorePost,
  deleteFirestoreReel,
  deleteFirestoreMatchRecord,
  uploadAnnouncementMediaToCloud,
  publishFirestoreAnnouncement,
  subscribeToFirestoreAnnouncements,
  deleteFirestoreAnnouncement,
  isVideoContentExpired,
  deriveUsername,
} from '../lib/firebase';
import {
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  RefreshCw,
  Search,
  Download,
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
  Trophy,
  ChevronRight,
  Send,
  ShieldAlert,
  Image as ImageIcon,
  Video,
  Film,
  Loader2,
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
  messages: Array<Message & { timestampIso?: string; createdAtMs?: number }>;
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
  reels: Reel[];
  matchHistory: MatchHistoryRecord[];
}

interface AdminViewProps {
  onExitAdmin: () => void;
}

type SortOption = 'joined_desc' | 'login_desc' | 'points_desc' | 'name_asc';
type StatusFilter = 'all' | 'active' | 'suspended' | 'idle_30d';
type InspectorTab = 'overview' | 'chats' | 'activity' | 'moderation';

const ADMIN_TOKEN_KEY = 'jit_admin_phone_token_v3';
const ADMIN_EXPIRY_KEY = 'jit_admin_phone_expiry_v3';
const OWNER_ADMIN_PHONE = '8017462677';
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
  const { syncServerProfiles, registeredProfiles } = useAuth();
  const {
    refreshAnnouncements,
    posts: localPosts,
    reels: localReels,
    announcements: localAnnouncements,
    deletePost,
    deleteReel,
  } = useSocial();

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

  // Global Announcement Broadcaster modal/panel
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annMessage, setAnnMessage] = useState('');
  const [annPriority, setAnnPriority] = useState<'important' | 'info' | 'event'>('important');
  const [annPostToFeed, setAnnPostToFeed] = useState(true);
  const [annMediaFile, setAnnMediaFile] = useState<File | null>(null);
  const [annMediaPreviewUrl, setAnnMediaPreviewUrl] = useState<string | null>(null);
  const [annMediaType, setAnnMediaType] = useState<'none' | 'image' | 'video'>('none');
  const [annUploadProgress, setAnnUploadProgress] = useState<number>(0);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // User Inspection Drawer state
  const [inspectedUser, setInspectedUser] = useState<AdminUserRecord | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [activityData, setActivityData] = useState<UserActivityPayload | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);
  const [activityFeedback, setActivityFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Admin Profile Override form state
  const [editFullName, setEditFullName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active');
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
  const annImageInputRef = useRef<HTMLInputElement>(null);
  const annVideoInputRef = useRef<HTMLInputElement>(null);

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
    if (adminToken === 'vercel-spa-admin') {
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
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json') || !res.ok) {
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
        const mergedMap = new Map<string, AdminUserRecord>();
        let serverFirebaseCount = 0;
        let usedExpressApi = false;

        if (token !== 'vercel-spa-admin') {
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
            setAuthError('Invalid Admin Access Code');
            return;
          }

          const data = await safeParseJsonResponse<{ success?: boolean; error?: string; users?: AdminUserRecord[]; firebaseCount?: number; analytics?: any; syncedAt?: string }>(usersRes);
          if (data) {
            if (!usersRes.ok || !data.success) {
              setLoadError(data.error || 'Unable to load Firebase user directory.');
              return;
            }
            usedExpressApi = true;

            if (annRes.ok) {
              const annData = await safeParseJsonResponse<{ announcements?: GlobalAnnouncement[] }>(annRes);
              const incomingAnns = annData?.announcements;
              if (Array.isArray(incomingAnns)) {
                setAnnouncements((prev) => {
                  const byId = new Map<string, GlobalAnnouncement>();
                  for (const a of [...incomingAnns, ...prev]) {
                    if (!isVideoContentExpired(a) && !byId.has(a.id)) byId.set(a.id, a);
                  }
                  return Array.from(byId.values()).sort(
                    (a, b) => (b.createdAtMs || Date.parse(b.createdAt) || 0) - (a.createdAtMs || Date.parse(a.createdAt) || 0)
                  );
                });
              }
            }

            const serverUsers: AdminUserRecord[] = Array.isArray(data.users) ? data.users : [];
            for (const u of serverUsers) {
              mergedMap.set(u.id, u);
            }
            serverFirebaseCount = Number(data.firebaseCount || 0);

            if (data.analytics) {
              setAnalytics({
                ...data.analytics,
                totalUsers: Math.max(Number(data.analytics.totalUsers || 0), mergedMap.size),
              });
            }
            setLastSyncedAt(data.syncedAt || new Date().toISOString());
          }
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

        if (!usedExpressApi) {
          try {
            const lbEntries = await fetchGlobalLeaderboard(500);
            for (const entry of lbEntries) {
              if (!mergedMap.has(entry.profileId)) {
                const matchedLocal = registeredProfiles.find((p) => p.id === entry.profileId);
                mergedMap.set(entry.profileId, {
                  id: entry.profileId,
                  contactNumber: matchedLocal?.contactNumber || '—',
                  fullName: entry.fullName,
                  username: matchedLocal?.username || deriveUsername(entry.fullName),
                  address: matchedLocal?.address || 'JIT Campus',
                  bio: matchedLocal?.bio || '',
                  avatarUrl: entry.avatarUrl || '/assets/aistudio/image_e64e54f2.png',
                  coverUrl: matchedLocal?.coverUrl,
                  joinedAt: matchedLocal?.joinedAt || new Date().toISOString(),
                  lastLoginAt: matchedLocal?.lastLoginAt || matchedLocal?.lastLogin || new Date().toISOString(),
                  lastLogin: matchedLocal?.lastLogin || new Date().toISOString(),
                  status: matchedLocal?.status || 'active',
                  stats: {
                    friendsCount: matchedLocal?.stats?.friendsCount ?? 0,
                    followersCount: matchedLocal?.stats?.followersCount ?? 0,
                    followingCount: matchedLocal?.stats?.followingCount ?? 0,
                    postsCount: matchedLocal?.stats?.postsCount ?? 0,
                    reelsCount: matchedLocal?.stats?.reelsCount ?? 0,
                    gamesPlayed: entry.gamesPlayed,
                    gamesWon: entry.gamesWon,
                    rewardPoints: entry.rewardPoints,
                    streakDays: entry.streakDays,
                  },
                  source: 'firebase',
                });
                directFirebaseUsers++;
              }
            }
          } catch {
            // Best-effort Firestore leaderboard fallback
          }

          for (const rp of registeredProfiles) {
            if (!mergedMap.has(rp.id)) {
              mergedMap.set(rp.id, { ...rp, source: 'local-mirror' });
            }
          }

          setAnnouncements((prev) => {
            const byId = new Map<string, GlobalAnnouncement>();
            for (const a of [...localAnnouncements, ...prev]) {
              if (!isVideoContentExpired(a) && !byId.has(a.id)) byId.set(a.id, a);
            }
            return Array.from(byId.values()).sort(
              (a, b) => (b.createdAtMs || Date.parse(b.createdAt) || 0) - (a.createdAtMs || Date.parse(a.createdAt) || 0)
            );
          });
          setLastSyncedAt(new Date().toISOString());
        }

        const finalList = Array.from(mergedMap.values());
        setUsers(finalList);
        setFirebaseCount(Math.max(serverFirebaseCount, directFirebaseUsers));

        if (!usedExpressApi) {
          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          const dau = finalList.filter((u) => {
            const ts = Date.parse(u.lastLoginAt || u.lastLogin || u.joinedAt || '');
            return !isNaN(ts) && ts >= dayAgo;
          }).length;
          setAnalytics({
            totalUsers: finalList.length,
            dailyActiveUsers: dau,
            totalPosts: localPosts.length,
            activeChatThreads: 0,
            totalMessages: 0,
            activeAnnouncements: localAnnouncements.length,
          });
        } else {
          setAnalytics((prev) => ({
            ...prev,
            totalUsers: Math.max(prev.totalUsers, finalList.length),
          }));
        }
      } catch {
        setLoadError('Network error while connecting to Firebase directory.');
      } finally {
        setLoadingUsers(false);
      }
    },
    [adminToken, clearSession, registeredProfiles, localAnnouncements, localPosts]
  );

  useEffect(() => {
    if (adminToken && !verifyingSession) {
      fetchAdminUsers(adminToken);
    }
  }, [adminToken, verifyingSession, fetchAdminUsers]);

  // Keep Admin announcements list live from Firestore regardless of Express/SPA mode
  useEffect(() => {
    if (!adminToken || verifyingSession) return;
    const unsub = subscribeToFirestoreAnnouncements((cloudItems) => {
      setAnnouncements((prev) => {
        const byId = new Map<string, GlobalAnnouncement>();
        for (const a of cloudItems) {
          if (!isVideoContentExpired(a)) byId.set(a.id, a);
        }
        for (const p of prev) {
          if (!byId.has(p.id) && !isVideoContentExpired(p)) byId.set(p.id, p);
        }
        return Array.from(byId.values()).sort(
          (a, b) => (b.createdAtMs || Date.parse(b.createdAt) || 0) - (a.createdAtMs || Date.parse(a.createdAt) || 0)
        );
      });
    });
    return () => unsub();
  }, [adminToken, verifyingSession]);

  const populateEditForm = useCallback((user: AdminUserRecord) => {
    setEditFullName(user.fullName || '');
    setEditUsername(user.username || deriveUsername(user.fullName || 'JIT Member', user.contactNumber));
    setEditStatus(user.status === 'suspended' ? 'suspended' : 'active');
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
      setSelectedThreadId('');
      setDmSearchQuery('');
      setActivityFeedback(null);
      populateEditForm(user);
      setActivityError('');
      setLoadingActivity(true);

      try {
        const [expressResult, cloudChatResult, cloudActResult] = await Promise.allSettled([
          adminToken !== 'vercel-spa-admin'
            ? fetch(`/api/admin/users/${encodeURIComponent(user.id)}/activity`, {
                headers: { Authorization: `Bearer ${adminToken}` },
              })
            : Promise.resolve(null),
          adminFetchUserChatActivityClient(user.id),
          adminFetchUserActivityClient(user.id),
        ]);

        let resolvedUser: AdminUserRecord = user;
        const convMap = new Map<string, Conversation>();
        const msgMap = new Map<string, Message & { timestampIso?: string; createdAtMs?: number }>();
        const gameMsgMap = new Map<string, UserActivityPayload['inGameMessages'][number]>();
        const postMap = new Map<string, Post>();
        const reelMap = new Map<string, Reel>();
        const matchMap = new Map<string, MatchHistoryRecord>();

        if (expressResult.status === 'fulfilled' && expressResult.value) {
          const res = expressResult.value;
          if (res.status === 401) {
            clearSession();
            return;
          }
          const data = res.ok ? await safeParseJsonResponse<any>(res) : null;
          if (data?.success) {
            if (data.user) resolvedUser = { ...resolvedUser, ...data.user };
            (data.conversations || []).forEach((c: Conversation) => convMap.set(c.id, c));
            (data.messages || []).forEach((m: any) => msgMap.set(m.id, m));
            (data.inGameMessages || []).forEach((gm: any) => gameMsgMap.set(gm.id, gm));
            (data.posts || []).forEach((p: Post) => postMap.set(p.id, p));
            (data.reels || []).forEach((r: Reel) => reelMap.set(r.id, r));
            (data.matchHistory || []).forEach((mh: MatchHistoryRecord) => matchMap.set(mh.id, mh));
          }
        }

        if (cloudChatResult.status === 'fulfilled') {
          cloudChatResult.value.conversations.forEach((c) => {
            if (!convMap.has(c.id)) convMap.set(c.id, c);
          });
          cloudChatResult.value.messages.forEach((m) => {
            if (!msgMap.has(m.id)) msgMap.set(m.id, m);
          });
        }

        if (cloudActResult.status === 'fulfilled') {
          cloudActResult.value.posts.forEach((p) => {
            if (!postMap.has(p.id)) postMap.set(p.id, p);
          });
          cloudActResult.value.reels.forEach((r) => {
            if (!reelMap.has(r.id)) reelMap.set(r.id, r);
          });
          cloudActResult.value.matchHistory.forEach((mh) => {
            if (!matchMap.has(mh.id)) matchMap.set(mh.id, mh);
          });
        }

        // Merge any matching local posts / reels not yet indexed
        for (const p of localPosts) {
          const hasComment = (p.comments || []).some(
            (c) =>
              c.authorId === user.id ||
              (c.replies || []).some((r) => r.authorId === user.id)
          );
          if ((p.authorId === user.id || hasComment) && !postMap.has(p.id) && !isVideoContentExpired(p)) {
            postMap.set(p.id, p);
          }
        }
        for (const r of localReels) {
          if (r.creatorId === user.id && !reelMap.has(r.id) && !isVideoContentExpired(r)) {
            reelMap.set(r.id, r);
          }
        }

        const mergedMessages = Array.from(msgMap.values()).sort((a, b) => {
          const tA = a.createdAtMs || (a.timestampIso ? Date.parse(a.timestampIso) : 0);
          const tB = b.createdAtMs || (b.timestampIso ? Date.parse(b.timestampIso) : 0);
          return tA - tB;
        });

        const mergedConversations = Array.from(convMap.values()).sort(
          (a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
        );
        const mergedPosts = Array.from(postMap.values()).sort(
          (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
        );
        const mergedReels = Array.from(reelMap.values()).sort(
          (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
        );
        const mergedMatches = Array.from(matchMap.values()).sort(
          (a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
        );

        setInspectedUser(resolvedUser);
        populateEditForm(resolvedUser);
        setActivityData({
          user: resolvedUser,
          conversations: mergedConversations,
          messages: mergedMessages,
          inGameMessages: Array.from(gameMsgMap.values()),
          posts: mergedPosts,
          reels: mergedReels,
          matchHistory: mergedMatches,
        });
      } catch {
        setActivityError('Network error loading user chat and activity logs.');
      } finally {
        setLoadingActivity(false);
      }
    },
    [adminToken, clearSession, populateEditForm, localPosts, localReels]
  );

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pinInput.trim();

    if (trimmed !== OWNER_ADMIN_PHONE) {
      setAuthError('Invalid Admin Access Code');
      return;
    }

    setAuthError('');
    setSubmittingPin(true);

    // Immediate client-side unlock (no server timeout errors on Vercel / static SPA)
    const fallbackToken = 'vercel-spa-admin';
    try {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, fallbackToken);
      sessionStorage.setItem(ADMIN_EXPIRY_KEY, String(Date.now() + 4 * 3600_000));
    } catch {
      // Ignore storage restrictions
    }

    setPinInput('');
    setAdminToken(fallbackToken);
    setSubmittingPin(false);

    // Best-effort background upgrade to Express session token when local backend is active
    try {
      if (!(await detectExpressBackendAvailable())) return;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2000);
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: trimmed, pin: trimmed }),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);
      const data = await safeParseJsonResponse<{ success?: boolean; token?: string; expiresAt?: number }>(res);
      if (res.ok && data?.success && data?.token) {
        try {
          sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
          sessionStorage.setItem(
            ADMIN_EXPIRY_KEY,
            String(data.expiresAt || Date.now() + 4 * 3600_000)
          );
        } catch {
          // Ignore
        }
        setAdminToken(data.token);
      }
    } catch {
      // Client-side admin dashboard remains unlocked cleanly
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

    const cleanUsername = deriveUsername(
      editFullName.trim() || inspectedUser.fullName,
      inspectedUser.contactNumber,
      editUsername
    );

    setSavingEdits(true);
    try {
      let updatedUser: AdminUserRecord | null = null;

      if (adminToken !== 'vercel-spa-admin') {
        try {
          const res = await fetch(`/api/admin/users/${encodeURIComponent(inspectedUser.id)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
              fullName: editFullName.trim(),
              username: cleanUsername,
              status: editStatus,
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

          const data = await safeParseJsonResponse<{ success?: boolean; error?: string; user?: AdminUserRecord }>(res);
          if (data) {
            if (!res.ok || !data.success || !data.user) {
              setEditFeedback({ type: 'err', text: data.error || 'Failed to save user overrides.' });
              return;
            }
            updatedUser = { ...data.user, source: inspectedUser.source || 'firebase' };
          }
        } catch {
          // Fall through to direct Firestore client override if backend is offline
        }
      }

      if (!updatedUser) {
        const directUpdated = await adminOverrideCloudProfileClient(inspectedUser, {
          fullName: editFullName.trim(),
          username: cleanUsername,
          status: editStatus,
          bio: editBio,
          avatarUrl: editAvatarUrl.trim() || '/assets/aistudio/image_e64e54f2.png',
          coverUrl: editCoverUrl.trim(),
          rewardPoints: Math.floor(parsedPoints),
        });
        updatedUser = { ...directUpdated, source: inspectedUser.source || 'firebase' };
      }

      setInspectedUser(updatedUser);
      setEditUsername(updatedUser.username || cleanUsername);
      setEditStatus(updatedUser.status === 'suspended' ? 'suspended' : 'active');
      setUsers((prev) => prev.map((u) => (u.id === updatedUser!.id ? updatedUser! : u)));
      setEditFeedback({ type: 'ok', text: 'User profile, username, status & JIT Points saved to Firebase.' });
      syncServerProfiles().catch(() => {});
    } catch (err: any) {
      setEditFeedback({ type: 'err', text: err?.message || 'Network error while saving profile overrides.' });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleModerateUser = async (action: 'suspend' | 'unblock' | 'delete') => {
    if (!adminToken || !inspectedUser) return;
    setModeratingBusy(true);
    setModerationFeedback(null);

    try {
      let moderatedProfile: UserProfile | null = null;
      let handledByExpress = false;

      if (adminToken !== 'vercel-spa-admin') {
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

          const data = await safeParseJsonResponse<{ success?: boolean; error?: string; user?: UserProfile }>(res);
          if (data) {
            if (!res.ok || !data.success) {
              setModerationFeedback({ type: 'err', text: data.error || 'Moderation action failed.' });
              return;
            }
            handledByExpress = true;
            moderatedProfile = data.user || null;
          }
        } catch {
          // Fall back to direct Firestore moderation client helper
        }
      }

      if (!handledByExpress) {
        moderatedProfile = await adminModerateCloudProfileClient(
          inspectedUser,
          action,
          suspendReason.trim() || undefined
        );
      }

      if (action === 'delete') {
        if (auth.currentUser?.email) {
          deleteCloudProfileAsAdmin(inspectedUser).catch(() => {});
        }
        // Also purge user posts/reels from live SocialContext UI immediately
        localPosts.filter((p) => p.authorId === inspectedUser.id).forEach((p) => deletePost(p.id));
        localReels.filter((r) => r.creatorId === inspectedUser.id).forEach((r) => deleteReel(r.id));
        setUsers((prev) => prev.filter((u) => u.id !== inspectedUser.id));
        setAnalytics((prev) => ({ ...prev, totalUsers: Math.max(0, prev.totalUsers - 1) }));
        setInspectedUser(null);
        setActivityData(null);
        syncServerProfiles().catch(() => {});
        return;
      }

      const updated: AdminUserRecord = {
        ...(moderatedProfile || inspectedUser),
        status: action === 'suspend' ? 'suspended' : 'active',
        source: inspectedUser.source || 'firebase',
      };
      setInspectedUser(updated);
      setEditStatus(updated.status === 'suspended' ? 'suspended' : 'active');
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setModerationFeedback({
        type: 'ok',
        text:
          action === 'suspend'
            ? 'Account suspended. User cannot log in or update data until unblocked.'
            : 'Account unblocked and restored to active status.',
      });
      syncServerProfiles().catch(() => {});
    } catch (err: any) {
      setModerationFeedback({ type: 'err', text: err?.message || 'Error applying moderation action.' });
    } finally {
      setModeratingBusy(false);
    }
  };

  const handleDeleteUserPost = async (postId: string) => {
    if (!adminToken) return;
    setDeletingActivityId(postId);
    setActivityFeedback(null);
    try {
      if (adminToken !== 'vercel-spa-admin') {
        await fetch(`/api/admin/posts/${encodeURIComponent(postId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).catch(() => {});
      }
      await deleteFirestorePost(postId);
      deletePost(postId);
      setActivityData((prev) =>
        prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== postId) } : prev
      );
      setAnalytics((prev) => ({ ...prev, totalPosts: Math.max(0, prev.totalPosts - 1) }));
      setActivityFeedback({ type: 'ok', text: 'Post removed from Firestore and feed.' });
    } catch {
      setActivityFeedback({ type: 'err', text: 'Could not delete post.' });
    } finally {
      setDeletingActivityId(null);
    }
  };

  const handleDeleteUserReel = async (reelId: string) => {
    if (!adminToken) return;
    setDeletingActivityId(reelId);
    setActivityFeedback(null);
    try {
      if (adminToken !== 'vercel-spa-admin') {
        await fetch(`/api/admin/reels/${encodeURIComponent(reelId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).catch(() => {});
      }
      await deleteFirestoreReel(reelId);
      deleteReel(reelId);
      setActivityData((prev) =>
        prev ? { ...prev, reels: prev.reels.filter((r) => r.id !== reelId) } : prev
      );
      setActivityFeedback({ type: 'ok', text: 'Reel deleted from Firestore and Reels feed.' });
    } catch {
      setActivityFeedback({ type: 'err', text: 'Could not delete reel.' });
    } finally {
      setDeletingActivityId(null);
    }
  };

  const handleDeleteUserMatch = async (matchId: string) => {
    if (!adminToken) return;
    setDeletingActivityId(matchId);
    setActivityFeedback(null);
    try {
      if (adminToken !== 'vercel-spa-admin') {
        await fetch(`/api/admin/matches/${encodeURIComponent(matchId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).catch(() => {});
      }
      await deleteFirestoreMatchRecord(matchId);
      setActivityData((prev) =>
        prev ? { ...prev, matchHistory: prev.matchHistory.filter((m) => m.id !== matchId) } : prev
      );
      setActivityFeedback({ type: 'ok', text: 'Game match record deleted from Firestore.' });
    } catch {
      setActivityFeedback({ type: 'err', text: 'Could not delete match log.' });
    } finally {
      setDeletingActivityId(null);
    }
  };

  const handleAnnouncementMediaPick = (
    e: React.ChangeEvent<HTMLInputElement>,
    category: 'image' | 'video'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBroadcastFeedback(null);

    const validation = validateMediaFile(file, {
      allowedCategory: category,
      maxSizeMb: category === 'video' ? 50 : 12,
    });
    if (!validation.valid) {
      setBroadcastFeedback({ type: 'err', text: validation.error || 'Invalid media file.' });
      return;
    }

    if (annMediaPreviewUrl && annMediaPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(annMediaPreviewUrl);
    }
    setAnnMediaFile(file);
    setAnnMediaType(category);
    setAnnMediaPreviewUrl(URL.createObjectURL(file));
    setAnnUploadProgress(0);
  };

  const handleClearAnnouncementMedia = () => {
    if (annMediaPreviewUrl && annMediaPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(annMediaPreviewUrl);
    }
    setAnnMediaFile(null);
    setAnnMediaPreviewUrl(null);
    setAnnMediaType('none');
    setAnnUploadProgress(0);
    if (annImageInputRef.current) annImageInputRef.current.value = '';
    if (annVideoInputRef.current) annVideoInputRef.current.value = '';
  };

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken || !annTitle.trim() || !annMessage.trim()) return;
    setSendingBroadcast(true);
    setBroadcastFeedback(null);
    setAnnUploadProgress(0);

    try {
      let mediaUrl: string | undefined;
      let mediaType: 'image' | 'video' | 'none' = 'none';
      let thumbnailUrl: string | undefined;
      let expiresAt: number | undefined;

      if (annMediaFile) {
        const uploaded = await uploadAnnouncementMediaToCloud(annMediaFile, (pct) => {
          setAnnUploadProgress(pct);
        });
        mediaUrl = uploaded.mediaUrl;
        mediaType = uploaded.mediaType;
        thumbnailUrl = uploaded.thumbnailUrl;
        expiresAt = uploaded.expiresAt;
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const annId = `ann_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;
      const fallbackAnnouncement: GlobalAnnouncement = {
        id: annId,
        title: annTitle.trim().slice(0, 140),
        message: annMessage.trim().slice(0, 1000),
        priority: annPriority,
        authorName: 'JIT GROUP Admin',
        createdAt: nowIso,
        createdAtMs: nowMs,
        ...(mediaUrl ? { mediaUrl, mediaType } : {}),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
      };

      let publishedViaExpress = false;
      let finalAnnouncement = fallbackAnnouncement;

      if (adminToken !== 'vercel-spa-admin') {
        try {
          const res = await fetch('/api/admin/announcements', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
              id: annId,
              title: annTitle.trim(),
              message: annMessage.trim(),
              priority: annPriority,
              alsoPostToFeed: annPostToFeed,
              ...(mediaUrl ? { mediaUrl, mediaType } : {}),
              ...(thumbnailUrl ? { thumbnailUrl } : {}),
              ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
            }),
          });

          if (res.status === 401) {
            clearSession();
            return;
          }

          const data = await safeParseJsonResponse<{ success?: boolean; error?: string; announcement?: GlobalAnnouncement; announcements?: GlobalAnnouncement[] }>(res);
          if (data) {
            if (!res.ok || !data.success) {
              setBroadcastFeedback({ type: 'err', text: data.error || 'Failed to publish announcement.' });
              return;
            }
            publishedViaExpress = true;
            if (data.announcement) finalAnnouncement = data.announcement;
            if (Array.isArray(data.announcements)) {
              setAnnouncements(data.announcements);
            }
          }
        } catch {
          // Fall back to direct Firestore publishing below
        }
      }

      // Always ensure announcement is persisted to Firestore directly too
      await publishFirestoreAnnouncement(finalAnnouncement);

      if (!publishedViaExpress && annPostToFeed) {
        await publishFirestorePost({
          id: `post_ann_${finalAnnouncement.id}`,
          authorId: 'usr_jit_admin_system',
          authorName: 'JIT GROUP Official Notice',
          authorAvatar: '/assets/aistudio/image_e64e54f2.png',
          authorHandle: '@jit_announcement',
          content: `${finalAnnouncement.title}\n\n${finalAnnouncement.message}`,
          mediaUrls: finalAnnouncement.mediaUrl ? [finalAnnouncement.mediaUrl] : [],
          mediaType: finalAnnouncement.mediaUrl ? finalAnnouncement.mediaType || 'image' : 'none',
          ...(finalAnnouncement.thumbnailUrl ? { thumbnailUrl: finalAnnouncement.thumbnailUrl } : {}),
          createdAt: 'Just now',
          createdAtMs: finalAnnouncement.createdAtMs || Date.now(),
          ...(typeof finalAnnouncement.expiresAt === 'number'
            ? { expiresAt: finalAnnouncement.expiresAt }
            : {}),
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          isLiked: false,
          isSaved: false,
          likedBy: [],
          comments: [],
          category: 'all',
        }).catch(() => {});
      }

      if (!publishedViaExpress) {
        setAnnouncements((prev) => [finalAnnouncement, ...prev.filter((a) => a.id !== finalAnnouncement.id)]);
      }

      setAnnTitle('');
      setAnnMessage('');
      handleClearAnnouncementMedia();
      setBroadcastFeedback({
        type: 'ok',
        text: mediaUrl
          ? 'Media announcement broadcasted to all user feeds & popup banners.'
          : 'Site-wide announcement broadcasted to all user feeds.',
      });
      refreshAnnouncements().catch(() => {});
      fetchAdminUsers().catch(() => {});
    } catch {
      setBroadcastFeedback({ type: 'err', text: 'Failed to publish announcement. Please try again.' });
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!adminToken) return;
    try {
      if (adminToken !== 'vercel-spa-admin' && (await detectExpressBackendAvailable())) {
        const res = await fetch(`/api/admin/announcements/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).catch(() => null);
        if (res && res.ok) {
          const data = await safeParseJsonResponse<{ announcements?: GlobalAnnouncement[] }>(res);
          if (Array.isArray(data?.announcements)) {
            setAnnouncements(data.announcements);
          }
        }
      }
      await deleteFirestoreAnnouncement(id);
      deletePost(`post_ann_${id}`);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      refreshAnnouncements().catch(() => {});
      fetchAdminUsers().catch(() => {});
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

  // Categorized per-user DM & Group threads for Admin Inspector
  const dmThreads = useMemo(() => {
    if (!activityData || !inspectedUser) return [];

    const profileLookup = new Map<string, { fullName?: string; username?: string; avatarUrl?: string }>();
    for (const p of [...users, ...registeredProfiles, inspectedUser]) {
      if (p?.id) profileLookup.set(p.id, p);
    }

    type AdminChatMsg = Message & { timestampIso?: string; createdAtMs?: number };
    const msgsByConv = new Map<string, AdminChatMsg[]>();

    for (const msg of activityData.messages || []) {
      let cid = (msg.conversationId || '').trim();
      if (!cid && msg.senderId && msg.receiverId) {
        const pair = [msg.senderId, msg.receiverId].sort();
        cid = `dm_${pair[0]}__${pair[1]}`;
      }
      if (!cid) cid = `dm_${msg.senderId || 'unknown'}`;
      const arr = msgsByConv.get(cid) || [];
      arr.push(msg);
      msgsByConv.set(cid, arr);
    }

    const convById = new Map<string, Conversation>();
    for (const conv of activityData.conversations || []) {
      if (conv?.id) convById.set(conv.id, conv);
    }

    const allThreadIds = Array.from(new Set([...convById.keys(), ...msgsByConv.keys()]));

    const threads = allThreadIds.map((cid) => {
      const conv = convById.get(cid);
      const msgs = [...(msgsByConv.get(cid) || [])].sort((a, b) => {
        const tA = a.createdAtMs || (a.timestampIso ? Date.parse(a.timestampIso) : 0);
        const tB = b.createdAtMs || (b.timestampIso ? Date.parse(b.timestampIso) : 0);
        return tA - tB;
      });

      const threadType: 'direct' | 'group' =
        conv?.type === 'group' || cid.startsWith('grp_') ? 'group' : 'direct';

      let peerId = '';
      if (threadType === 'direct') {
        peerId = conv?.participantIds?.find((pid) => pid && pid !== inspectedUser.id) || '';
        if (!peerId) {
          for (const m of msgs) {
            if (m.senderId && m.senderId !== inspectedUser.id) {
              peerId = m.senderId;
              break;
            }
            if (m.receiverId && m.receiverId !== inspectedUser.id) {
              peerId = m.receiverId;
              break;
            }
          }
        }
        if (!peerId && cid.startsWith('dm_')) {
          const parts = cid.slice(3).split('__');
          peerId = parts.find((p) => p && p !== inspectedUser.id) || '';
        }
      }

      const knownPeer = peerId ? profileLookup.get(peerId) : undefined;
      const mapPeer = peerId ? conv?.participantsMap?.[peerId] : undefined;
      const peerMsg = peerId ? msgs.find((m) => m.senderId === peerId) : msgs.find((m) => m.senderId !== inspectedUser.id);

      let participantName = '';
      if (threadType === 'group') {
        participantName = (conv?.name || 'Group Chat').trim();
      } else {
        const convNameCandidate =
          conv?.name &&
          conv.name !== 'Conversation' &&
          conv.name.toLowerCase() !== (inspectedUser.fullName || '').trim().toLowerCase()
            ? conv.name
            : '';
        participantName = (
          knownPeer?.fullName ||
          mapPeer?.name ||
          peerMsg?.senderName ||
          convNameCandidate ||
          (peerId ? `Member ${peerId.slice(-4)}` : 'Campus Member')
        ).trim();
      }

      const avatarUrl =
        knownPeer?.avatarUrl ||
        mapPeer?.avatar ||
        peerMsg?.senderAvatar ||
        conv?.avatarUrl ||
        APP_CONFIG.logoUrl;

      const lastMsg = msgs[msgs.length - 1];
      let lastMessagePreview = 'No messages yet';
      if (lastMsg?.content?.trim()) {
        lastMessagePreview = lastMsg.content.trim();
      } else if (lastMsg?.mediaType === 'video') {
        lastMessagePreview = 'Video attachment';
      } else if (lastMsg?.mediaUrl) {
        lastMessagePreview = 'Photo attachment';
      } else if (conv?.lastMessage?.text?.trim()) {
        lastMessagePreview = conv.lastMessage.text.trim();
      }

      const updatedAtMs = Math.max(
        lastMsg?.createdAtMs || (lastMsg?.timestampIso ? Date.parse(lastMsg.timestampIso) : 0) || 0,
        conv?.updatedAtMs || 0
      );

      let lastMessageTime = lastMsg?.createdAt || conv?.lastMessage?.createdAt || conv?.updatedAt || '';
      if (updatedAtMs > 0) {
        const dt = formatDateTime(new Date(updatedAtMs).toISOString());
        lastMessageTime = dt.time ? `${dt.date} · ${dt.time}` : dt.date;
      } else if (!lastMessageTime) {
        lastMessageTime = 'Recent';
      }

      const participantSubtitle =
        threadType === 'group'
          ? `${conv?.participantIds?.length || msgs.length} participants`
          : knownPeer?.username
          ? `@${knownPeer.username}`
          : peerId || 'Direct Message';

      return {
        id: cid,
        type: threadType,
        displayTitle: threadType === 'group' ? `Group: ${participantName}` : `DM: ${participantName}`,
        participantName,
        participantSubtitle,
        avatarUrl,
        lastMessagePreview,
        lastMessageTime,
        updatedAtMs,
        messages: msgs,
      };
    });

    return threads.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [activityData, inspectedUser, users, registeredProfiles]);

  const filteredDmThreads = useMemo(() => {
    const q = dmSearchQuery.trim().toLowerCase();
    if (!q) return dmThreads;
    return dmThreads.filter((t) => {
      if (t.displayTitle.toLowerCase().includes(q)) return true;
      if (t.participantName.toLowerCase().includes(q)) return true;
      if (t.lastMessagePreview.toLowerCase().includes(q)) return true;
      return t.messages.some(
        (m) =>
          (m.content || '').toLowerCase().includes(q) ||
          (m.senderName || '').toLowerCase().includes(q)
      );
    });
  }, [dmThreads, dmSearchQuery]);

  const activeDmThread = useMemo(() => {
    if (filteredDmThreads.length === 0) return null;
    if (selectedThreadId) {
      const exact = filteredDmThreads.find((t) => t.id === selectedThreadId);
      if (exact) return exact;
    }
    return filteredDmThreads[0];
  }, [filteredDmThreads, selectedThreadId]);

  const activeThreadMessages = useMemo(() => {
    if (!activeDmThread) return [];
    const q = dmSearchQuery.trim().toLowerCase();
    if (!q) return activeDmThread.messages;
    if (
      activeDmThread.displayTitle.toLowerCase().includes(q) ||
      activeDmThread.participantName.toLowerCase().includes(q)
    ) {
      return activeDmThread.messages;
    }
    const matching = activeDmThread.messages.filter(
      (m) =>
        (m.content || '').toLowerCase().includes(q) ||
        (m.senderName || '').toLowerCase().includes(q)
    );
    return matching.length > 0 ? matching : activeDmThread.messages;
  }, [activeDmThread, dmSearchQuery]);

  // --------------------------------------------------------------------------
  // Phone-Only Admin Gate (Displayed whenever locked; normal users cannot bypass)
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
                  Admin Phone Verification
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
            <form onSubmit={handleUnlockSubmit} noValidate className="space-y-4">
              <div>
                <label
                  htmlFor="admin-phone-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Authorized Admin Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    id="admin-phone-input"
                    type={showPin ? 'tel' : 'password'}
                    inputMode="numeric"
                    autoFocus
                    autoComplete="off"
                    value={pinInput}
                    onChange={(e) => {
                      setPinInput(e.target.value);
                      if (authError) setAuthError('');
                    }}
                    placeholder="Enter authorized admin phone number"
                    className="w-full min-h-[44px] pl-10 pr-12 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-900 dark:text-white font-mono tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
                    aria-label={showPin ? 'Hide phone number' : 'Show phone number'}
                  >
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Only the authorized owner phone number can unlock user profiles, personal chat logs, and platform management controls.
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2"
                >
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
                  {submittingPin ? 'Verifying...' : 'Unlock Dashboard'}
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

              {/* Photo & Video Attachment Controls */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={annImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleAnnouncementMediaPick(e, 'image')}
                    className="hidden"
                  />
                  <input
                    ref={annVideoInputRef}
                    type="file"
                    accept="video/*"
                    onChange={(e) => handleAnnouncementMediaPick(e, 'video')}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => annImageInputRef.current?.click()}
                    disabled={sendingBroadcast}
                    className="min-h-[40px] px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Attach Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => annVideoInputRef.current?.click()}
                    disabled={sendingBroadcast}
                    className="min-h-[40px] px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <Video className="w-3.5 h-3.5 text-blue-600" />
                    <span>Attach Video</span>
                  </button>
                  {annMediaType === 'video' && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      Video announcements auto-expire after 40 days
                    </span>
                  )}
                </div>

                {annMediaPreviewUrl && (
                  <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 w-full">
                    {annMediaType === 'video' ? (
                      <ResilientVideo
                        src={annMediaPreviewUrl}
                        controls
                        compactControls
                        className="w-full h-auto max-h-56 object-contain"
                      />
                    ) : (
                      <ResponsiveImage
                        src={annMediaPreviewUrl}
                        alt="Announcement attachment"
                        fit="contain"
                        className="w-full h-auto max-h-56 object-contain mx-auto block"
                      />
                    )}
                    <button
                      type="button"
                      onClick={handleClearAnnouncementMedia}
                      className="absolute top-2 right-2 z-20 min-w-[36px] min-h-[36px] flex items-center justify-center bg-red-600/90 hover:bg-red-700 text-white rounded-lg"
                      aria-label="Remove attached media"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {sendingBroadcast && annMediaFile && annUploadProgress > 0 && annUploadProgress < 100 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-slate-500">
                      <span>Uploading announcement media...</span>
                      <span>{annUploadProgress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-200"
                        style={{ width: `${annUploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
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
                  {sendingBroadcast ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>{sendingBroadcast ? 'Publishing Notice...' : 'Broadcast to All Feeds'}</span>
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
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {announcements.map((ann) => {
                    const ts = formatDateTime(ann.createdAt);
                    return (
                      <div
                        key={ann.id}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-2.5"
                      >
                        {ann.mediaUrl && (
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                            {ann.mediaType === 'video' ? (
                              ann.thumbnailUrl ? (
                                <ResponsiveImage
                                  src={ann.thumbnailUrl}
                                  alt="Video notice"
                                  fit="cover"
                                  containerClassName="w-full h-full"
                                />
                              ) : (
                                <Video className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                              )
                            ) : (
                              <ResponsiveImage
                                src={ann.mediaUrl}
                                alt="Notice media"
                                fit="cover"
                                containerClassName="w-full h-full"
                              />
                            )}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {ann.title}
                          </p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
                            {ann.message}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono tabular-nums mt-1">
                            {ann.priority.toUpperCase()}
                            {ann.mediaType ? ` · ${ann.mediaType.toUpperCase()}` : ''} · {ts.date} {ts.time}
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
                    label: `Posts, Reels & Games (${
                      (activityData?.posts?.length || 0) +
                      (activityData?.reels?.length || 0) +
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
                          Username (@handle)
                        </label>
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          placeholder="e.g. rahul_jit"
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Account Status
                        </label>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as 'active' | 'suspended')}
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended / Blocked</option>
                        </select>
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

              {/* TAB 2: Personal Chat Activity & DMs (Categorized Per-User Thread Viewer) */}
              {inspectorTab === 'chats' && (
                <div className="space-y-4">
                  {loadingActivity ? (
                    <div className="py-10 text-center text-xs text-slate-500">
                      Loading personal chat threads &amp; direct messages...
                    </div>
                  ) : (
                    <>
                      {/* DM & Participant Search */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            type="text"
                            value={dmSearchQuery}
                            onChange={(e) => setDmSearchQuery(e.target.value)}
                            placeholder="Filter threads by participant name or message..."
                            className="w-full min-h-[40px] pl-10 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          {dmThreads.length} {dmThreads.length === 1 ? 'thread' : 'threads'} · {activityData?.messages?.length ?? 0} total msgs
                        </span>
                      </div>

                      {filteredDmThreads.length === 0 ? (
                        <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                          {dmThreads.length === 0
                            ? 'No DM or group conversations recorded yet for this account.'
                            : 'No chat threads matched your filter.'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-12 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                          {/* Left Column: Clickable Per-User Thread List */}
                          <div className="md:col-span-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 max-h-[260px] md:max-h-[460px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
                            {filteredDmThreads.map((thread) => {
                              const isSelected = activeDmThread?.id === thread.id;
                              return (
                                <button
                                  key={thread.id}
                                  type="button"
                                  onClick={() => setSelectedThreadId(thread.id)}
                                  className={`w-full text-left p-3 flex items-center gap-3 transition-colors min-h-[64px] ${
                                    isSelected
                                      ? 'bg-blue-50/90 dark:bg-blue-950/40'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                  }`}
                                >
                                  <img
                                    src={thread.avatarUrl}
                                    alt={thread.participantName}
                                    className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p
                                        className={`text-xs font-bold truncate ${
                                          isSelected
                                            ? 'text-blue-700 dark:text-blue-300'
                                            : 'text-slate-900 dark:text-white'
                                        }`}
                                      >
                                        {thread.displayTitle}
                                      </p>
                                      <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">
                                        {thread.messages.length}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate mt-0.5">
                                      {thread.lastMessagePreview}
                                    </p>
                                    <p className="text-[10px] font-mono tabular-nums text-slate-400 mt-0.5 truncate">
                                      {thread.lastMessageTime}
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {/* Right Column: Selected User Pair Conversation Transcript ONLY */}
                          <div className="md:col-span-7 flex flex-col max-h-[460px] bg-slate-50/60 dark:bg-slate-950/40">
                            {activeDmThread ? (
                              <>
                                {/* Thread Header */}
                                <div className="px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <img
                                      src={activeDmThread.avatarUrl}
                                      alt={activeDmThread.participantName}
                                      className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                        {activeDmThread.displayTitle}
                                      </h3>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                        {activeDmThread.participantSubtitle} · {activeThreadMessages.length}{' '}
                                        {activeThreadMessages.length === 1 ? 'message' : 'messages'}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                {/* Interactive Chronological History */}
                                <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                                  {activeThreadMessages.length === 0 ? (
                                    <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                                      No messages recorded inside this conversation yet.
                                    </div>
                                  ) : (
                                    activeThreadMessages.map((msg) => {
                                      const isInspectedSender = msg.senderId === inspectedUser.id;
                                      const msgTime = msg.createdAtMs
                                        ? (() => {
                                            const dt = formatDateTime(new Date(msg.createdAtMs).toISOString());
                                            return dt.time ? `${dt.date} ${dt.time}` : dt.date;
                                          })()
                                        : msg.createdAt;
                                      return (
                                        <div
                                          key={msg.id}
                                          className={`flex flex-col ${
                                            isInspectedSender ? 'items-end' : 'items-start'
                                          }`}
                                        >
                                          <div
                                            className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs space-y-1.5 ${
                                              isInspectedSender
                                                ? 'bg-blue-600 text-white rounded-tr-sm'
                                                : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-tl-sm'
                                            }`}
                                          >
                                            <div className="flex items-center justify-between gap-3 text-[10px]">
                                              <span
                                                className={`font-bold ${
                                                  isInspectedSender
                                                    ? 'text-blue-100'
                                                    : 'text-blue-600 dark:text-blue-400'
                                                }`}
                                              >
                                                {isInspectedSender
                                                  ? inspectedUser.fullName
                                                  : msg.senderName || activeDmThread.participantName}
                                              </span>
                                            </div>
                                            {msg.mediaUrl && (
                                              <div className="rounded-xl overflow-hidden w-full">
                                                {msg.mediaType === 'video' ? (
                                                  <ResilientVideo
                                                    src={msg.mediaUrl}
                                                    controls
                                                    compactControls
                                                    className="w-full h-auto max-h-44 object-contain"
                                                  />
                                                ) : (
                                                  <ResponsiveImage
                                                    src={msg.mediaUrl}
                                                    alt="Chat attachment"
                                                    fit="contain"
                                                    className="w-full h-auto max-h-44 object-contain mx-auto block"
                                                    fallbackText="Attachment unavailable"
                                                  />
                                                )}
                                              </div>
                                            )}
                                            {msg.content && (
                                              <p className="whitespace-pre-wrap break-words leading-relaxed">
                                                {msg.content}
                                              </p>
                                            )}
                                          </div>
                                          <span className="text-[10px] font-mono tabular-nums text-slate-400 mt-1 px-1">
                                            {isInspectedSender ? 'Sent' : 'Received'} · {msgTime}
                                          </span>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="py-12 text-center text-xs text-slate-500">
                                Select a thread on the left to inspect its messages.
                              </div>
                            )}
                          </div>
                        </div>
                      )}

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

              {/* TAB 3: Posts, Reels & Match History with Admin Delete */}
              {inspectorTab === 'activity' && (
                <div className="space-y-5">
                  {activityFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                        activityFeedback.type === 'ok'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300'
                      }`}
                    >
                      {activityFeedback.type === 'ok' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{activityFeedback.text}</span>
                    </div>
                  )}

                  {loadingActivity ? (
                    <div className="py-10 text-center text-xs text-slate-500">
                      Loading user posts, reels, and match history...
                    </div>
                  ) : (
                    <>
                      {/* User Posts */}
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
                                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2 text-[11px] text-slate-500">
                                  <div>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                      {p.authorName}
                                    </span>
                                    <span className="ml-2 text-slate-400">{p.createdAt}</span>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={deletingActivityId === p.id}
                                    onClick={() => handleDeleteUserPost(p.id)}
                                    className="min-h-[32px] px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg flex items-center gap-1 shrink-0 disabled:opacity-50"
                                    title="Delete post"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{deletingActivityId === p.id ? 'Removing...' : 'Delete'}</span>
                                  </button>
                                </div>
                                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line break-words">
                                  {p.content}
                                </p>
                                {(() => {
                                  const primaryMediaUrl = p.mediaUrls?.find(
                                    (u) => typeof u === 'string' && u.trim().length > 0
                                  );
                                  if (!primaryMediaUrl || p.mediaType === 'none') return null;
                                  return (
                                    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 w-full">
                                      {p.mediaType === 'video' ? (
                                        <ResilientVideo
                                          src={primaryMediaUrl}
                                          poster={p.thumbnailUrl}
                                          controls
                                          compactControls
                                          className="w-full h-auto max-h-48 object-contain"
                                        />
                                      ) : (
                                        <ResponsiveImage
                                          src={primaryMediaUrl}
                                          alt="Post attachment"
                                          fit="contain"
                                          className="w-full h-auto max-h-48 object-contain mx-auto block"
                                          fallbackText="Post image unavailable"
                                        />
                                      )}
                                    </div>
                                  );
                                })()}
                                <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                                  {p.likesCount} likes · {p.comments?.length ?? p.commentsCount} comments
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* User Reels */}
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Film className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Uploaded Reels ({activityData?.reels?.length ?? 0})</span>
                        </h3>
                        {(activityData?.reels?.length ?? 0) === 0 ? (
                          <p className="text-xs text-slate-500 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                            No reels uploaded by this user.
                          </p>
                        ) : (
                          <div className="space-y-2.5">
                            {activityData?.reels.map((r) => (
                              <div
                                key={r.id}
                                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-start justify-between gap-3"
                              >
                                <div className="flex items-start gap-3 min-w-0">
                                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                    {r.thumbnailUrl ? (
                                      <ResponsiveImage
                                        src={r.thumbnailUrl}
                                        alt={r.caption || 'Reel thumbnail'}
                                        fit="cover"
                                        containerClassName="w-full h-full"
                                      />
                                    ) : (
                                      <Film className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                                    )}
                                  </div>
                                  <div className="min-w-0 space-y-1">
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2">
                                      {r.caption || 'Campus Reel'}
                                    </p>
                                    <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                                      {r.likesCount} likes · {r.commentsCount} comments · {r.createdAt}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={deletingActivityId === r.id}
                                  onClick={() => handleDeleteUserReel(r.id)}
                                  className="min-h-[32px] px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg flex items-center gap-1 shrink-0 disabled:opacity-50"
                                  title="Delete reel"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{deletingActivityId === r.id ? 'Removing...' : 'Delete'}</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Game Match Logs */}
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
                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right font-mono tabular-nums">
                                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                        +{m.pointsEarned} pts
                                      </span>
                                      <span className="block text-[10px] text-slate-400">
                                        {dt.date}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={deletingActivityId === m.id}
                                      onClick={() => handleDeleteUserMatch(m.id)}
                                      className="min-w-[32px] min-h-[32px] flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg disabled:opacity-50"
                                      title="Delete game log"
                                      aria-label="Delete game log"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
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

    </div>
  );
};
