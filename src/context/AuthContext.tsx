/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { UserProfile, GameId, MatchHistoryRecord, WalletTransaction } from '../types';
import { INITIAL_USER, INITIAL_FRIENDS } from '../services/mockData';
import { getSupabaseClient } from '../lib/supabase';
import {
  authPersistenceReady,
  subscribeToFirebaseAuthState,
  signOutFirebaseAuth,
  testFirestoreConnection,
  lookupCloudProfileByPhone,
  loginCloudProfileByPhone,
  registerOrRecognizeCloudProfile,
  updateCloudProfile,
  uploadProfilePhotoToCloud,
  ensureCloudProfileSeeded,
  touchCloudLoginTimestamp,
  syncLeaderboardEntry,
  recordCloudMatchHistory,
  subscribeToCloudProfile,
  claimCloudDailyReward,
  deleteCloudProfileByUser,
  normalizePhone10,
  DAILY_CLAIM_COOLDOWN_MS,
  DAILY_STREAK_GRACE_MS,
} from '../lib/firebase';
import {
  detectExpressBackendAvailable,
  safeFetchJson,
  safeParseJsonResponse,
} from '../utils/safeFetch';

export const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // 180 consecutive days (6 months)

export const BUILT_IN_DEMO_PROFILE_IDS = new Set<string>([
  'usr_jit_primary_001',
  'usr_jit_002',
  'usr_jit_003',
  'usr_jit_004',
]);

export function normalizePhoneDigits(phone: string): string {
  return normalizePhone10(phone);
}

export function isPhoneNumberMatch(a: string, b: string): boolean {
  const na = normalizePhone10(a);
  const nb = normalizePhone10(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 7 && nb.length >= 7 && (na.endsWith(nb) || nb.endsWith(na))) return true;
  return false;
}

export function isProfileExpired(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  // System demo account exemption
  if (profile.id === 'usr_jit_primary_001') return false;
  const lastActiveStr = profile.lastLoginAt || profile.lastLogin || profile.joinedAt;
  if (!lastActiveStr) return false;
  const lastActiveTime = new Date(lastActiveStr).getTime();
  if (isNaN(lastActiveTime)) return false;
  return Date.now() - lastActiveTime > INACTIVITY_EXPIRY_MS;
}

export function calculateDaysRemaining(profile: UserProfile | null | undefined): number {
  if (!profile) return 180;
  if (profile.id === 'usr_jit_primary_001') return 180;
  const lastActiveStr = profile.lastLoginAt || profile.lastLogin || profile.joinedAt;
  if (!lastActiveStr) return 180;
  const time = new Date(lastActiveStr).getTime();
  if (isNaN(time)) return 180;
  const daysSince = Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24));
  return Math.max(0, 180 - daysSince);
}

export interface AwardGameParams {
  gameId: GameId;
  gameName: string;
  mode: 'ai' | 'friend' | 'random' | 'solo';
  outcome: 'win' | 'loss' | 'draw' | 'spin';
  pointsEarned: number;
  scoreSummary: string;
}

interface AuthContextType {
  currentUser: UserProfile | null;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  registeredProfiles: UserProfile[];
  loginWithContact: (contactNumber: string) => Promise<{ success: boolean; error?: string; user?: UserProfile }>;
  registerUser: (
    contactNumber: string,
    fullName: string,
    address: string
  ) => Promise<{ success: boolean; error?: string; user?: UserProfile; isExisting?: boolean; message?: string }>;
  logout: () => void;
  removeSavedProfile: (userId: string) => void;
  deleteOwnAccount: () => Promise<{ success: boolean; error?: string }>;
  syncLocalFriendsCount: (count: number) => void;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  claimDailyReward: () => Promise<{
    success: boolean;
    pointsAdded: number;
    newTotal: number;
    remainingMs?: number;
    error?: string;
  }>;
  awardGameResult: (params: AwardGameParams) => Promise<{ success: boolean; newTotal: number; pointsAdded: number }>;
  spendRewardPoints: (
    amount: number,
    description: string,
    type?: WalletTransaction['type']
  ) => { success: boolean; newTotal: number; error?: string };
  switchUser: (userId: string) => void;
  syncServerProfiles: () => Promise<void>;
  isExpired: (profile: UserProfile) => boolean;
  daysRemaining: number;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LS_CURRENT_USER = 'jit_current_user';
const LS_PROFILES = 'jit_registered_profiles';
const LS_LOGGED_OUT = 'jit_logged_out';
const LS_REMOVED_SAVED_PROFILES = 'jit_removed_saved_profiles_v1';
export const LS_WALLET_TX = 'jit_wallet_transactions';
export const LS_MATCH_HISTORY = 'jit_match_history';
const LS_DAILY_CLAIM_PREFIX = 'jit_daily_claim_';

export { DAILY_CLAIM_COOLDOWN_MS, DAILY_STREAK_GRACE_MS };

export function readLocalDailyClaimAt(userId?: string | null): number {
  if (typeof window === 'undefined' || !userId) return 0;
  try {
    const raw = localStorage.getItem(`${LS_DAILY_CLAIM_PREFIX}${userId}`);
    const parsed = Number(raw || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function writeLocalDailyClaimAt(userId: string, timestampMs: number): void {
  if (typeof window === 'undefined' || !userId || !Number.isFinite(timestampMs) || timestampMs <= 0) return;
  try {
    const existing = readLocalDailyClaimAt(userId);
    localStorage.setItem(`${LS_DAILY_CLAIM_PREFIX}${userId}`, String(Math.max(existing, timestampMs)));
  } catch {
    // Non-fatal storage error
  }
}

export function getDailyClaimRemainingMs(
  userOrTimestamp?: UserProfile | number | null,
  nowMs: number = Date.now()
): number {
  const claimTs =
    typeof userOrTimestamp === 'number'
      ? userOrTimestamp
      : userOrTimestamp
      ? Math.max(
          Number(userOrTimestamp.lastDailyClaimAt || 0),
          readLocalDailyClaimAt(userOrTimestamp.id)
        )
      : 0;
  if (!claimTs || !Number.isFinite(claimTs) || claimTs <= 0) return 0;
  const elapsed = nowMs - claimTs;
  if (elapsed >= DAILY_CLAIM_COOLDOWN_MS) return 0;
  return Math.max(0, DAILY_CLAIM_COOLDOWN_MS - elapsed);
}

export function formatDailyClaimCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function hydrateDailyClaimTimestamp(profile: UserProfile): UserProfile {
  const localTs = readLocalDailyClaimAt(profile.id);
  const mergedTs = Math.max(Number(profile.lastDailyClaimAt || 0), localTs);
  if (mergedTs > 0) {
    writeLocalDailyClaimAt(profile.id, mergedTs);
    return { ...profile, lastDailyClaimAt: mergedTs };
  }
  return profile;
}

function appendWalletTransaction(tx: WalletTransaction) {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(LS_WALLET_TX);
    const list: WalletTransaction[] = raw ? JSON.parse(raw) : [];
    const updated = [tx, ...(Array.isArray(list) ? list : [])].slice(0, 60);
    localStorage.setItem(LS_WALLET_TX, JSON.stringify(updated));
  } catch {
    // Non-fatal
  }
}

function appendLocalMatchHistory(rec: MatchHistoryRecord) {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(LS_MATCH_HISTORY);
    const list: MatchHistoryRecord[] = raw ? JSON.parse(raw) : [];
    const updated = [rec, ...(Array.isArray(list) ? list : [])].slice(0, 40);
    localStorage.setItem(LS_MATCH_HISTORY, JSON.stringify(updated));
  } catch {
    // Non-fatal
  }
}

function readPersistedUser(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  if (localStorage.getItem(LS_LOGGED_OUT) === 'true') {
    return null;
  }
  const saved = localStorage.getItem(LS_CURRENT_USER);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    if (parsed && parsed.id) {
      if (
        isProfileExpired(parsed) ||
        parsed.status === 'deleted' ||
        parsed.status === 'suspended'
      ) {
        localStorage.removeItem(LS_CURRENT_USER);
        return null;
      }
      return hydrateDailyClaimTimestamp(parsed);
    }
  } catch (e) {
    console.error('Failed to parse cached current user', e);
  }
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const readRemovedSavedIds = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(LS_REMOVED_SAVED_PROFILES);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };

  const [removedSavedProfileIds, setRemovedSavedProfileIds] = useState<string[]>(() =>
    readRemovedSavedIds()
  );

  const [registeredProfiles, setRegisteredProfiles] = useState<UserProfile[]>(() => {
    const removedSet = new Set(readRemovedSavedIds());
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_PROFILES);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Auto-clean any accounts inactive for >180 days, deleted, or removed from quick login
            return parsed.filter(
              (p: UserProfile) =>
                !isProfileExpired(p) &&
                p.status !== 'deleted' &&
                (!removedSet.has(p.id) || BUILT_IN_DEMO_PROFILE_IDS.has(p.id))
            );
          }
        } catch (e) {
          console.error('Failed to parse cached profiles', e);
        }
      }
    }
    return [INITIAL_USER, ...INITIAL_FRIENDS];
  });

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => readPersistedUser());
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);

  const currentUserRef = useRef<UserProfile | null>(currentUser);
  currentUserRef.current = currentUser;
  const registeredProfilesRef = useRef<UserProfile[]>(registeredProfiles);
  registeredProfilesRef.current = registeredProfiles;
  const removedSavedProfileIdsRef = useRef<string[]>(removedSavedProfileIds);
  removedSavedProfileIdsRef.current = removedSavedProfileIds;
  const confirmedCloudProfileRef = useRef<string | null>(null);
  const claimInFlightRef = useRef<boolean>(false);

  const unmarkRemovedSavedProfile = useCallback((userId: string) => {
    setRemovedSavedProfileIds((prev) => {
      if (!prev.includes(userId)) return prev;
      const next = prev.filter((id) => id !== userId);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(LS_REMOVED_SAVED_PROFILES, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentUser) {
        // If expired, clear immediately
        if (isProfileExpired(currentUser)) {
          setCurrentUser(null);
          localStorage.removeItem(LS_CURRENT_USER);
        } else {
          localStorage.setItem(LS_CURRENT_USER, JSON.stringify(currentUser));
          localStorage.removeItem(LS_LOGGED_OUT);
        }
      } else {
        localStorage.removeItem(LS_CURRENT_USER);
      }
      // Save only active profiles to localStorage
      const activeProfiles = registeredProfiles.filter((p) => !isProfileExpired(p));
      localStorage.setItem(LS_PROFILES, JSON.stringify(activeProfiles));
    }
  }, [currentUser, registeredProfiles]);

  // Root Firebase Auth Observer + LocalStorage Cross-Tab Persistence Check
  useEffect(() => {
    let mounted = true;
    let unsubAuth: (() => void) | undefined;
    let settled = false;

    const markReady = () => {
      if (!settled && mounted) {
        settled = true;
        setIsAuthLoading(false);
      }
    };

    const safetyTimer = window.setTimeout(markReady, 1800);

    authPersistenceReady.finally(() => {
      if (!mounted) return;
      unsubAuth = subscribeToFirebaseAuthState(async (firebaseUser) => {
        if (!mounted) return;
        try {
          const explicitlyLoggedOut =
            typeof window !== 'undefined' && localStorage.getItem(LS_LOGGED_OUT) === 'true';

          if (firebaseUser && !explicitlyLoggedOut) {
            const persisted = currentUserRef.current || readPersistedUser();
            if (persisted) {
              setCurrentUser((prev) => prev || persisted);
            } else {
              const matchedLocal = registeredProfilesRef.current.find(
                (p) =>
                  p.id === firebaseUser.uid ||
                  (firebaseUser.phoneNumber &&
                    isPhoneNumberMatch(p.contactNumber, firebaseUser.phoneNumber))
              );
              if (
                matchedLocal &&
                !isProfileExpired(matchedLocal) &&
                matchedLocal.status !== 'deleted' &&
                matchedLocal.status !== 'suspended'
              ) {
                setCurrentUser(matchedLocal);
                if (typeof window !== 'undefined') {
                  localStorage.setItem(LS_CURRENT_USER, JSON.stringify(matchedLocal));
                  localStorage.removeItem(LS_LOGGED_OUT);
                }
              } else if (firebaseUser.phoneNumber) {
                const cloudLookup = await lookupCloudProfileByPhone(firebaseUser.phoneNumber).catch(
                  () => null
                );
                if (
                  cloudLookup?.found &&
                  cloudLookup.profile &&
                  cloudLookup.profile.status !== 'deleted' &&
                  cloudLookup.profile.status !== 'suspended'
                ) {
                  setCurrentUser(cloudLookup.profile);
                  if (typeof window !== 'undefined') {
                    localStorage.setItem(LS_CURRENT_USER, JSON.stringify(cloudLookup.profile));
                    localStorage.removeItem(LS_LOGGED_OUT);
                  }
                }
              } else {
                const nowIso = new Date().toISOString();
                const restoredUser: UserProfile = {
                  id: firebaseUser.uid,
                  contactNumber:
                    firebaseUser.phoneNumber || firebaseUser.email || firebaseUser.uid.slice(0, 12),
                  fullName: firebaseUser.displayName || 'JIT Member',
                  address: 'JIT Campus',
                  bio: 'Proud member of JIT GROUP campus community.',
                  avatarUrl: firebaseUser.photoURL || '/assets/aistudio/image_e64e54f2.png',
                  joinedAt: nowIso,
                  lastLoginAt: nowIso,
                  lastLogin: nowIso,
                  stats: {
                    friendsCount: 0,
                    followersCount: 0,
                    followingCount: 0,
                    postsCount: 0,
                    reelsCount: 0,
                    gamesPlayed: 0,
                    gamesWon: 0,
                    rewardPoints: 100,
                    streakDays: 1,
                  },
                };
                setCurrentUser(restoredUser);
                if (typeof window !== 'undefined') {
                  localStorage.setItem(LS_CURRENT_USER, JSON.stringify(restoredUser));
                  localStorage.removeItem(LS_LOGGED_OUT);
                }
              }
            }
          }
        } finally {
          window.clearTimeout(safetyTimer);
          markReady();
        }
      });
    });

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === LS_CURRENT_USER || e.key === LS_LOGGED_OUT) {
        const nextUser = readPersistedUser();
        setCurrentUser(nextUser);
      }
    };
    window.addEventListener('storage', handleStorageSync);

    return () => {
      mounted = false;
      window.clearTimeout(safetyTimer);
      unsubAuth?.();
      window.removeEventListener('storage', handleStorageSync);
    };
  }, []);

  // Sync profiles with shared cloud Firestore & backend server on startup
  const syncServerProfiles = useCallback(async () => {
    try {
      await testFirestoreConnection();

      let cloudResolvedProfile: UserProfile | null = null;
      const activeUser = currentUserRef.current;

      // Verify & refresh current user directly from Firestore so edits/photos/logins/moderation sync across devices
      if (activeUser && activeUser.contactNumber) {
        try {
          const cloudCurrent = await lookupCloudProfileByPhone(activeUser.contactNumber);
          if (cloudCurrent.expired || (cloudCurrent.found && cloudCurrent.profile?.status === 'deleted')) {
            setCurrentUser(null);
            setRegisteredProfiles((prev) => prev.filter((p) => p.id !== activeUser.id));
            if (typeof window !== 'undefined') {
              localStorage.removeItem(LS_CURRENT_USER);
            }
          } else if (cloudCurrent.found && cloudCurrent.profile?.status === 'suspended') {
            setCurrentUser(null);
            setRegisteredProfiles((prev) =>
              prev.map((p) => (p.id === cloudCurrent.profile!.id ? cloudCurrent.profile! : p))
            );
            if (typeof window !== 'undefined') {
              localStorage.removeItem(LS_CURRENT_USER);
            }
          } else if (cloudCurrent.found && cloudCurrent.profile) {
            cloudResolvedProfile = hydrateDailyClaimTimestamp(cloudCurrent.profile);
            confirmedCloudProfileRef.current = cloudResolvedProfile.id;
            const cloudProfile = cloudResolvedProfile;
            setCurrentUser((prev) => {
              if (!prev) return cloudProfile;
              const mergedClaimAt = Math.max(
                Number(prev.lastDailyClaimAt || 0),
                Number(cloudProfile.lastDailyClaimAt || 0),
                readLocalDailyClaimAt(cloudProfile.id)
              );
              return {
                ...prev,
                ...cloudProfile,
                ...(mergedClaimAt > 0 ? { lastDailyClaimAt: mergedClaimAt } : {}),
              };
            });
            setRegisteredProfiles((prev) => {
              const without = prev.filter((p) => p.id !== cloudProfile.id);
              return [cloudProfile, ...without];
            });
          } else if (!isProfileExpired(activeUser)) {
            await ensureCloudProfileSeeded(activeUser);
          }
        } catch (cloudErr) {
          console.warn('Firestore current user sync notice:', cloudErr);
        }
      }

      // 1. Fetch server profiles only when Express backend API is available (validates JSON content-type)
      const hasBackend = await detectExpressBackendAvailable();
      const serverProfilesRes = hasBackend
        ? await safeFetchJson<{ profiles?: Array<UserProfile & { adminPointsUpdatedAt?: string }> }>('/api/profiles')
        : { ok: false, status: 0, isJson: false, data: null };
      if (serverProfilesRes.ok && serverProfilesRes.data) {
        const data = serverProfilesRes.data;
        const serverProfiles: Array<UserProfile & { adminPointsUpdatedAt?: string }> = data.profiles || [];
        const activeServerProfiles = serverProfiles.filter(
          (p) => !isProfileExpired(p) && p.status !== 'deleted'
        );

        setRegisteredProfiles((prev) => {
          const removedSet = new Set(removedSavedProfileIdsRef.current);
          const map = new Map<string, UserProfile>();
          // Add existing local state first (excluding expired & removed saved)
          for (const p of prev) {
            if (
              !isProfileExpired(p) &&
              p.status !== 'deleted' &&
              (!removedSet.has(p.id) || BUILT_IN_DEMO_PROFILE_IDS.has(p.id))
            ) {
              map.set(p.id, p);
            }
          }
          // Merge server profiles (preserving authoritative Firestore photos/overrides if already loaded)
          for (const sp of activeServerProfiles) {
            if (removedSet.has(sp.id) && !BUILT_IN_DEMO_PROFILE_IDS.has(sp.id)) continue;
            const localExisting = Array.from(map.values()).find(
              (p) => isPhoneNumberMatch(p.contactNumber, sp.contactNumber) || p.id === sp.id
            );
            if (localExisting) {
              const isCloudCurrent = cloudResolvedProfile && localExisting.id === cloudResolvedProfile.id;
              const freshestLoginAt =
                new Date(sp.lastLoginAt || sp.joinedAt).getTime() >
                new Date(localExisting.lastLoginAt || localExisting.joinedAt).getTime()
                  ? sp.lastLoginAt
                  : localExisting.lastLoginAt;
              const adminPointsOverride =
                sp.adminPointsUpdatedAt &&
                new Date(sp.adminPointsUpdatedAt).getTime() >=
                  new Date(localExisting.lastLoginAt || 0).getTime();

              map.set(localExisting.id, {
                ...localExisting,
                ...sp,
                id: localExisting.id,
                avatarUrl: isCloudCurrent
                  ? cloudResolvedProfile!.avatarUrl
                  : sp.avatarUrl || localExisting.avatarUrl,
                coverUrl: isCloudCurrent
                  ? cloudResolvedProfile!.coverUrl
                  : sp.coverUrl ?? localExisting.coverUrl,
                lastLoginAt: freshestLoginAt,
                lastLogin: freshestLoginAt,
                stats: {
                  ...localExisting.stats,
                  ...sp.stats,
                  rewardPoints: isCloudCurrent
                    ? cloudResolvedProfile!.stats.rewardPoints
                    : adminPointsOverride
                    ? sp.stats?.rewardPoints ?? localExisting.stats?.rewardPoints ?? 0
                    : Math.max(localExisting.stats?.rewardPoints ?? 0, sp.stats?.rewardPoints ?? 0),
                  gamesPlayed: Math.max(localExisting.stats?.gamesPlayed ?? 0, sp.stats?.gamesPlayed ?? 0),
                  gamesWon: Math.max(localExisting.stats?.gamesWon ?? 0, sp.stats?.gamesWon ?? 0),
                  streakDays: Math.max(localExisting.stats?.streakDays ?? 1, sp.stats?.streakDays ?? 1),
                },
              });
            } else {
              map.set(sp.id, sp);
            }
          }
          const merged = Array.from(map.values()).filter((p) => !isProfileExpired(p) && p.status !== 'deleted');
          if (typeof window !== 'undefined') {
            localStorage.setItem(LS_PROFILES, JSON.stringify(merged));
          }
          return merged;
        });

        // If current user wasn't refreshed from Firestore, merge fresher server data carefully
        const latestActive = currentUserRef.current;
        if (latestActive && !cloudResolvedProfile) {
          const matchedServer = serverProfiles.find(
            (p) => p.id === latestActive.id || isPhoneNumberMatch(p.contactNumber, latestActive.contactNumber)
          );
          if (matchedServer) {
            if (matchedServer.status === 'suspended' || matchedServer.status === 'deleted') {
              setCurrentUser(null);
              if (typeof window !== 'undefined') {
                localStorage.removeItem(LS_CURRENT_USER);
              }
            } else {
              setCurrentUser((prev) => {
                if (!prev) return null;
                const serverTs = new Date(matchedServer.lastLoginAt || matchedServer.joinedAt || 0).getTime();
                const prevTs = new Date(prev.lastLoginAt || prev.joinedAt || 0).getTime();
                const base = serverTs >= prevTs ? { ...prev, ...matchedServer } : { ...matchedServer, ...prev };
                const adminPointsOverride =
                  matchedServer.adminPointsUpdatedAt &&
                  new Date(matchedServer.adminPointsUpdatedAt).getTime() >= prevTs;
                return {
                  ...base,
                  lastDailyClaimAt:
                    Math.max(
                      Number(prev.lastDailyClaimAt || 0),
                      Number(matchedServer.lastDailyClaimAt || 0),
                      readLocalDailyClaimAt(prev.id)
                    ) || undefined,
                  stats: {
                    ...base.stats,
                    rewardPoints: adminPointsOverride
                      ? matchedServer.stats?.rewardPoints ?? prev.stats?.rewardPoints ?? 0
                      : Math.max(prev.stats?.rewardPoints ?? 0, matchedServer.stats?.rewardPoints ?? 0),
                    gamesPlayed: Math.max(prev.stats?.gamesPlayed ?? 0, matchedServer.stats?.gamesPlayed ?? 0),
                    gamesWon: Math.max(prev.stats?.gamesWon ?? 0, matchedServer.stats?.gamesWon ?? 0),
                    streakDays:
                      Number(prev.lastDailyClaimAt || 0) >= Number(matchedServer.lastDailyClaimAt || 0) &&
                      prev.lastDailyClaimAt
                        ? prev.stats?.streakDays ?? 1
                        : Math.max(prev.stats?.streakDays ?? 1, matchedServer.stats?.streakDays ?? 1),
                  },
                };
              });
            }
          }
        }
      }

      // 2. Backup valid local profiles to shared cloud backend & Firestore
      const nonExpired = registeredProfilesRef.current.filter(
        (p) => !isProfileExpired(p) && p.status !== 'deleted'
      );
      if (nonExpired.length > 0) {
        for (const p of nonExpired) {
          ensureCloudProfileSeeded(p).catch(() => {});
        }
        if (hasBackend) {
          await fetch('/api/profiles/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profiles: nonExpired }),
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Initial server profiles sync notice:', err);
    }
  }, []);

  useEffect(() => {
    syncServerProfiles();
  }, [syncServerProfiles]);

  // Real-time Firestore profile listener so admin overrides (points, username, photos)
  // and moderation actions (suspend/delete) take immediate effect across active sessions
  useEffect(() => {
    if (!currentUser?.id) {
      confirmedCloudProfileRef.current = null;
      return;
    }
    const uid = currentUser.id;
    const unsub = subscribeToCloudProfile(uid, (cloudProfile, exists) => {
      if (exists && cloudProfile) {
        confirmedCloudProfileRef.current = uid;
        if (cloudProfile.status === 'suspended' || cloudProfile.status === 'deleted') {
          setCurrentUser(null);
          if (cloudProfile.status === 'deleted') {
            setRegisteredProfiles((prev) => prev.filter((p) => p.id !== uid));
          } else {
            setRegisteredProfiles((prev) =>
              prev.map((p) => (p.id === uid ? cloudProfile : p))
            );
          }
          if (typeof window !== 'undefined') {
            localStorage.removeItem(LS_CURRENT_USER);
            if (cloudProfile.status === 'deleted') {
              localStorage.setItem(LS_LOGGED_OUT, 'true');
            }
          }
          return;
        }
        const hydratedCloud = hydrateDailyClaimTimestamp(cloudProfile);
        setCurrentUser((prev) => {
          if (!prev || prev.id !== uid) return prev;
          const mergedClaimAt = Math.max(
            Number(prev.lastDailyClaimAt || 0),
            Number(hydratedCloud.lastDailyClaimAt || 0),
            readLocalDailyClaimAt(uid)
          );
          return {
            ...prev,
            ...hydratedCloud,
            ...(mergedClaimAt > 0 ? { lastDailyClaimAt: mergedClaimAt } : {}),
          };
        });
        setRegisteredProfiles((prev) =>
          prev.map((p) => (p.id === uid ? { ...p, ...hydratedCloud } : p))
        );
      } else if (!exists && confirmedCloudProfileRef.current === uid) {
        setCurrentUser(null);
        setRegisteredProfiles((prev) => prev.filter((p) => p.id !== uid));
        if (typeof window !== 'undefined') {
          localStorage.removeItem(LS_CURRENT_USER);
          localStorage.setItem(LS_LOGGED_OUT, 'true');
        }
      }
    });
    return () => unsub();
  }, [currentUser?.id]);

  // Helper to persist profile to shared backend server and Supabase (if configured)
  const persistProfileRemotely = async (
    profile: UserProfile,
    flags?: { explicitAvatarUpdate?: boolean; explicitCoverRemoval?: boolean }
  ) => {
    const nowIso = new Date().toISOString();
    const profileToPersist: UserProfile & {
      explicitAvatarUpdate?: boolean;
      explicitCoverRemoval?: boolean;
    } = {
      ...profile,
      ...(flags?.explicitCoverRemoval ? { coverUrl: '' } : {}),
      ...(flags?.explicitAvatarUpdate ? { explicitAvatarUpdate: true } : {}),
      ...(flags?.explicitCoverRemoval ? { explicitCoverRemoval: true } : {}),
      lastLoginAt: profile.lastLoginAt || nowIso,
      lastLogin: profile.lastLogin || profile.lastLoginAt || nowIso,
    };

    // 1. Backend Server Persistence (only when Express API is reachable)
    if (await detectExpressBackendAvailable()) {
      try {
        await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profileToPersist),
        });
      } catch (e) {
        console.warn('Failed to persist profile to server endpoint:', e);
      }
    }

    // 2. Supabase if credentials are provided
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('profiles').upsert({
          id: profileToPersist.id,
          contact_number: normalizePhoneDigits(profileToPersist.contactNumber),
          full_name: profileToPersist.fullName,
          address: profileToPersist.address,
          bio: profileToPersist.bio,
          avatar_url: profileToPersist.avatarUrl,
          cover_url: profileToPersist.coverUrl,
          created_at: profileToPersist.joinedAt,
          last_login_at: profileToPersist.lastLoginAt,
          is_contact_number_public: profileToPersist.isContactNumberPublic,
          is_address_public: profileToPersist.isAddressPublic,
          reward_points: profileToPersist.stats.rewardPoints,
          streak_days: profileToPersist.stats.streakDays,
        });
      } catch (err) {
        console.warn('Supabase upsert notice:', err);
      }
    }
  };

  // Login via Contact Number lookup
  // Checks shared Firestore cloud DB first so any browser/device/incognito tab recognizes accounts immediately.
  const loginWithContact = async (
    contactNumber: string
  ): Promise<{ success: boolean; error?: string; user?: UserProfile }> => {
    const digits = normalizePhoneDigits(contactNumber);
    if (!digits || digits.length < 7) {
      return { success: false, error: 'Please enter a valid contact number (at least 7 digits).' };
    }

    const nowIso = new Date().toISOString();

    // 1. Check shared Firebase Firestore database first (cross-browser, cross-device, incognito-safe)
    try {
      const cloudRes = await loginCloudProfileByPhone(contactNumber);
      if (cloudRes.suspended) {
        return {
          success: false,
          error: `This account has been suspended by an administrator. ${
            cloudRes.suspendedReason ? `Reason: ${cloudRes.suspendedReason}` : ''
          }`.trim(),
        };
      }
      if (cloudRes.expired) {
        setRegisteredProfiles((prev) =>
          prev.filter((p) => !isPhoneNumberMatch(p.contactNumber, contactNumber))
        );
        return {
          success: false,
          error:
            'This account was inactive for over 180 consecutive days and has been automatically cleared per our retention policy. Please register a new profile.',
        };
      }
      if (cloudRes.success && cloudRes.profile) {
        const activeUser = cloudRes.profile;
        unmarkRemovedSavedProfile(activeUser.id);
        setCurrentUser(activeUser);
        setRegisteredProfiles((prev) => {
          const withoutExpired = prev.filter((p) => !isProfileExpired(p));
          const exists = withoutExpired.some((p) => p.id === activeUser.id);
          if (exists) {
            return withoutExpired.map((p) => (p.id === activeUser.id ? activeUser : p));
          }
          return [activeUser, ...withoutExpired];
        });
        if (typeof window !== 'undefined') {
          localStorage.removeItem(LS_LOGGED_OUT);
          localStorage.setItem(LS_CURRENT_USER, JSON.stringify(activeUser));
        }
        persistProfileRemotely(activeUser).catch(() => {});
        return { success: true, user: activeUser };
      }
    } catch (cloudErr) {
      console.warn('Firestore login lookup notice, falling back to server/local:', cloudErr);
    }

    // 2. Try server login endpoint (only if Express API returns JSON, skips HTML SPA rewrites)
    const hasBackendApi = await detectExpressBackendAvailable();
    if (hasBackendApi) {
      try {
        const serverRes = await fetch('/api/profiles/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactNumber }),
        });
        if (serverRes.status === 403) {
          const errData = (await safeParseJsonResponse<{ error?: string }>(serverRes)) || {};
          return {
            success: false,
            error: errData.error || 'This account has been suspended by an administrator.',
          };
        }
        const data = await safeParseJsonResponse<{ success?: boolean; profile?: UserProfile }>(serverRes);
        if (serverRes.ok && data?.success && data.profile) {
          const activeUser: UserProfile = {
            ...data.profile,
            lastLoginAt: nowIso,
            lastLogin: nowIso,
          };
          setCurrentUser(activeUser);
          setRegisteredProfiles((prev) => {
            const withoutExpired = prev.filter((p) => !isProfileExpired(p));
            const exists = withoutExpired.some((p) => p.id === activeUser.id);
            if (exists) {
              return withoutExpired.map((p) => (p.id === activeUser.id ? activeUser : p));
            }
            return [activeUser, ...withoutExpired];
          });
          if (typeof window !== 'undefined') {
            localStorage.removeItem(LS_LOGGED_OUT);
            localStorage.setItem(LS_CURRENT_USER, JSON.stringify(activeUser));
          }
          await ensureCloudProfileSeeded(activeUser).catch(() => {});
          return { success: true, user: activeUser };
        }
      } catch (e) {
        console.warn('Backend login endpoint notice, attempting lookup:', e);
      }
    }

    // 3. Check local registered profiles
    let matched = registeredProfiles.find((p) => isPhoneNumberMatch(p.contactNumber, contactNumber));

    // 4. If not found locally, query server API when available
    if (!matched && hasBackendApi) {
      const lookupRes = await safeFetchJson<{ found?: boolean; profile?: UserProfile }>(
        `/api/profiles/lookup/${encodeURIComponent(contactNumber.trim())}`
      );
      if (lookupRes.ok && lookupRes.data?.found && lookupRes.data.profile) {
        matched = lookupRes.data.profile;
      }
    }

    // 5. If not found on server, query Supabase if available
    if (!matched) {
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('contact_number', digits)
            .maybeSingle();

          if (!error && data) {
            matched = {
              id: data.id,
              contactNumber: data.contact_number,
              fullName: data.full_name,
              address: data.address || '',
              bio: data.bio || '',
              avatarUrl: data.avatar_url || '/assets/aistudio/image_e64e54f2.png',
              coverUrl: data.cover_url,
              joinedAt: data.created_at || nowIso,
              lastLoginAt: nowIso,
              lastLogin: nowIso,
              isContactNumberPublic: data.is_contact_number_public || false,
              isAddressPublic: data.is_address_public || false,
              stats: {
                friendsCount: data.friends_count || 0,
                followersCount: data.followers_count || 0,
                followingCount: data.following_count || 0,
                postsCount: data.posts_count || 0,
                reelsCount: data.reels_count || 0,
                gamesPlayed: data.games_played || 0,
                gamesWon: data.games_won || 0,
                rewardPoints: data.reward_points || 100,
                streakDays: data.streak_days || 1,
              },
            };
          }
        } catch (err) {
          console.warn('Supabase lookup error:', err);
        }
      }
    }

    if (!matched || matched.status === 'deleted') {
      return {
        success: false,
        error: `No active account found for "${contactNumber}". Please register a new profile below.`,
      };
    }

    if (matched.status === 'suspended') {
      return {
        success: false,
        error: `This account has been suspended by an administrator. ${
          matched.suspendedReason ? `Reason: ${matched.suspendedReason}` : ''
        }`.trim(),
      };
    }

    // Check if account has exceeded 180 days of inactivity
    if (isProfileExpired(matched)) {
      setRegisteredProfiles((prev) => prev.filter((p) => p.id !== matched?.id));
      return {
        success: false,
        error: `This account was inactive for over 180 consecutive days and has been automatically cleared per our retention policy. Please register a new profile.`,
      };
    }

    // User found & active! Update lastLogin and lastLoginAt timestamp so account stays active for another 180 days
    const updatedUser: UserProfile = {
      ...matched,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
    };

    unmarkRemovedSavedProfile(updatedUser.id);
    setCurrentUser(updatedUser);
    setRegisteredProfiles((prev) => {
      const exists = prev.some((p) => p.id === updatedUser.id);
      if (exists) {
        return prev.map((p) => (p.id === updatedUser.id ? updatedUser : p));
      }
      return [updatedUser, ...prev];
    });

    if (typeof window !== 'undefined') {
      localStorage.removeItem(LS_LOGGED_OUT);
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updatedUser));
    }

    // Sync to shared Firestore cloud DB & backend server immediately
    await Promise.all([
      ensureCloudProfileSeeded(updatedUser).then(() => touchCloudLoginTimestamp(updatedUser)).catch(() => {}),
      persistProfileRemotely(updatedUser).catch(() => {}),
    ]);

    return { success: true, user: updatedUser };
  };

  // Register via Contact Number
  // Recognizes existing users across all browsers/devices without clearing data; or creates a permanent cloud profile
  const registerUser = async (
    contactNumber: string,
    fullName: string,
    address: string
  ): Promise<{ success: boolean; error?: string; user?: UserProfile; isExisting?: boolean; message?: string }> => {
    const digits = normalizePhoneDigits(contactNumber);
    if (!digits || digits.length < 7) {
      return { success: false, error: 'Please enter a valid contact number (at least 7 digits).' };
    }
    if (!fullName.trim()) {
      return { success: false, error: 'Full Name is required.' };
    }
    if (!address.trim()) {
      return { success: false, error: 'Address or Campus location is required.' };
    }

    const nowIso = new Date().toISOString();

    // Check any local/backend/Supabase active candidate in case account was created earlier before Firestore migration
    let seedCandidate = registeredProfiles.find(
      (p) => isPhoneNumberMatch(p.contactNumber, contactNumber) && !isProfileExpired(p)
    );

    if (!seedCandidate && (await detectExpressBackendAvailable())) {
      const lookupRes = await safeFetchJson<{ found?: boolean; profile?: UserProfile }>(
        `/api/profiles/lookup/${encodeURIComponent(contactNumber.trim())}`
      );
      if (lookupRes.ok && lookupRes.data?.found && lookupRes.data.profile && !isProfileExpired(lookupRes.data.profile)) {
        seedCandidate = lookupRes.data.profile;
      }
    }

    if (!seedCandidate) {
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('contact_number', digits)
            .maybeSingle();
          if (data) {
            const candidate: UserProfile = {
              id: data.id,
              contactNumber: data.contact_number,
              fullName: data.full_name,
              address: data.address || address.trim(),
              bio: data.bio || '',
              avatarUrl: data.avatar_url || '/assets/aistudio/image_e64e54f2.png',
              coverUrl: data.cover_url,
              joinedAt: data.created_at || nowIso,
              lastLoginAt: nowIso,
              lastLogin: nowIso,
              isContactNumberPublic: data.is_contact_number_public || false,
              isAddressPublic: data.is_address_public || false,
              stats: {
                friendsCount: data.friends_count || 0,
                followersCount: data.followers_count || 0,
                followingCount: data.following_count || 0,
                postsCount: data.posts_count || 0,
                reelsCount: data.reels_count || 0,
                gamesPlayed: data.games_played || 0,
                gamesWon: data.games_won || 0,
                rewardPoints: data.reward_points || 100,
                streakDays: data.streak_days || 1,
              },
            };
            if (!isProfileExpired(candidate)) {
              seedCandidate = candidate;
            }
          }
        } catch (e) {
          console.warn('Supabase lookup error during register:', e);
        }
      }
    }

    // Persist atomically to shared Firestore database (recognizing existing active cloud accounts automatically)
    try {
      const cloudReg = await registerOrRecognizeCloudProfile(
        contactNumber,
        fullName,
        address,
        seedCandidate
      );

      const finalUser = cloudReg.profile;
      const isExisting = cloudReg.isExisting || Boolean(seedCandidate);

      unmarkRemovedSavedProfile(finalUser.id);
      setCurrentUser(finalUser);
      setRegisteredProfiles((prev) => {
        const withoutExpired = prev.filter((p) => !isProfileExpired(p));
        const exists = withoutExpired.some((p) => p.id === finalUser.id);
        if (exists) {
          return withoutExpired.map((p) => (p.id === finalUser.id ? finalUser : p));
        }
        return [finalUser, ...withoutExpired];
      });

      if (typeof window !== 'undefined') {
        localStorage.removeItem(LS_LOGGED_OUT);
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(finalUser));
      }

      await persistProfileRemotely(finalUser);

      return {
        success: true,
        user: finalUser,
        isExisting,
        message: isExisting
          ? `Welcome back, ${finalUser.fullName}! Existing profile recognized without data loss. 180-day retention timer refreshed.`
          : `Welcome to JIT GROUP, ${finalUser.fullName}! Account created with 100 Welcome Points.`,
      };
    } catch (cloudErr) {
      console.warn('Firestore register fallback notice:', cloudErr);
    }

    // Fallback path if Firestore is unreachable offline
    if (seedCandidate && !isProfileExpired(seedCandidate)) {
      const recognizedUser: UserProfile = {
        ...seedCandidate,
        fullName: fullName.trim() || seedCandidate.fullName,
        address: address.trim() || seedCandidate.address,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        stats: {
          ...seedCandidate.stats,
          rewardPoints: Math.max(seedCandidate.stats?.rewardPoints ?? 100, 100),
          streakDays: Math.max(seedCandidate.stats?.streakDays ?? 1, 1),
        },
      };

      setCurrentUser(recognizedUser);
      setRegisteredProfiles((prev) =>
        prev.map((p) => (p.id === recognizedUser.id ? recognizedUser : p))
      );

      if (typeof window !== 'undefined') {
        localStorage.removeItem(LS_LOGGED_OUT);
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(recognizedUser));
      }

      await persistProfileRemotely(recognizedUser);

      return {
        success: true,
        user: recognizedUser,
        isExisting: true,
        message: `Welcome back, ${recognizedUser.fullName}! Existing profile recognized without data loss. 180-day retention timer refreshed.`,
      };
    }

    const newId = `usr_jit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newProfile: UserProfile = {
      id: newId,
      contactNumber: contactNumber.trim(),
      fullName: fullName.trim(),
      address: address.trim(),
      bio: 'Proud member of JIT GROUP campus community.',
      avatarUrl: '/assets/aistudio/image_e64e54f2.png',
      joinedAt: nowIso,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      isContactNumberPublic: false,
      isAddressPublic: false,
      stats: {
        friendsCount: 0,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        reelsCount: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        rewardPoints: 100, // 100 Welcome Points
        streakDays: 1,
      },
    };

    setRegisteredProfiles((prev) => [newProfile, ...prev.filter((p) => !isProfileExpired(p))]);
    setCurrentUser(newProfile);

    if (typeof window !== 'undefined') {
      localStorage.removeItem(LS_LOGGED_OUT);
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(newProfile));
    }

    await persistProfileRemotely(newProfile);

    return {
      success: true,
      user: newProfile,
      isExisting: false,
      message: `Welcome to JIT GROUP, ${newProfile.fullName}! Account created with 100 Welcome Points.`,
    };
  };

  const logout = () => {
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LS_CURRENT_USER);
      localStorage.setItem(LS_LOGGED_OUT, 'true');
    }
    signOutFirebaseAuth().catch(() => {});
  };

  const removeSavedProfile = useCallback((userId: string) => {
    if (!userId || BUILT_IN_DEMO_PROFILE_IDS.has(userId)) return;
    setRemovedSavedProfileIds((prev) => {
      const next = prev.includes(userId) ? prev : [...prev, userId];
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(LS_REMOVED_SAVED_PROFILES, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
    setRegisteredProfiles((prev) => {
      const next = prev.filter((p) => p.id !== userId);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(LS_PROFILES, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  const deleteOwnAccount = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const active = currentUserRef.current;
    if (!active) {
      return { success: false, error: 'No active account signed in.' };
    }
    if (BUILT_IN_DEMO_PROFILE_IDS.has(active.id)) {
      return { success: false, error: 'Built-in default demo profiles cannot be deleted.' };
    }
    try {
      await deleteCloudProfileByUser(active);
      setRegisteredProfiles((prev) => prev.filter((p) => p.id !== active.id));
      setRemovedSavedProfileIds((prev) => {
        const next = prev.includes(active.id) ? prev : [...prev, active.id];
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(LS_REMOVED_SAVED_PROFILES, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
      setCurrentUser(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(LS_CURRENT_USER);
        localStorage.setItem(LS_LOGGED_OUT, 'true');
      }
      signOutFirebaseAuth().catch(() => {});
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Could not delete account. Please try again.',
      };
    }
  }, []);

  const syncLocalFriendsCount = useCallback((count: number) => {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    setCurrentUser((prev) => {
      if (!prev || prev.stats?.friendsCount === safeCount) return prev;
      const updated: UserProfile = {
        ...prev,
        stats: {
          ...prev.stats,
          friendsCount: safeCount,
        },
      };
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updated));
        } catch {
          // ignore
        }
      }
      return updated;
    });
    setRegisteredProfiles((prev) => {
      const activeId = currentUserRef.current?.id;
      if (!activeId) return prev;
      let changed = false;
      const next = prev.map((p) => {
        if (p.id === activeId && p.stats?.friendsCount !== safeCount) {
          changed = true;
          return { ...p, stats: { ...p.stats, friendsCount: safeCount } };
        }
        return p;
      });
      return changed ? next : prev;
    });
  }, []);

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!currentUser) return;
    const nowIso = new Date().toISOString();
    const resolvedUpdates: Partial<UserProfile> = { ...updates };

    // Attempt Firebase Storage upload for new photo uploads (gracefully falls back to compressed Data URL)
    if (resolvedUpdates.avatarUrl && resolvedUpdates.avatarUrl.startsWith('data:image/')) {
      resolvedUpdates.avatarUrl = await uploadProfilePhotoToCloud(
        currentUser.id,
        'avatar',
        resolvedUpdates.avatarUrl
      );
    }
    if (resolvedUpdates.coverUrl && resolvedUpdates.coverUrl.startsWith('data:image/')) {
      resolvedUpdates.coverUrl = await uploadProfilePhotoToCloud(
        currentUser.id,
        'cover',
        resolvedUpdates.coverUrl
      );
    }

    const normalizedCoverUrl =
      resolvedUpdates.coverUrl === ''
        ? undefined
        : resolvedUpdates.coverUrl ?? currentUser.coverUrl;

    const updated: UserProfile = {
      ...currentUser,
      ...resolvedUpdates,
      coverUrl: normalizedCoverUrl,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      // Retain max stats & points
      stats: {
        ...currentUser.stats,
        ...(resolvedUpdates.stats || {}),
        rewardPoints: resolvedUpdates.stats?.rewardPoints ?? currentUser.stats.rewardPoints,
      },
    };

    setCurrentUser(updated);
    setRegisteredProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updated));
    }

    await Promise.all([
      updateCloudProfile(updated, resolvedUpdates).catch((err) => {
        console.warn('Cloud profile update notice:', err);
      }),
      syncLeaderboardEntry(updated).catch(() => {}),
      persistProfileRemotely(updated, {
        explicitAvatarUpdate: resolvedUpdates.avatarUrl !== undefined,
        explicitCoverRemoval: resolvedUpdates.coverUrl === '',
      }).catch(() => {}),
    ]);
  };

  const claimDailyReward = async (): Promise<{
    success: boolean;
    pointsAdded: number;
    newTotal: number;
    remainingMs?: number;
    error?: string;
  }> => {
    const activeUser = currentUserRef.current;
    if (!activeUser) {
      return { success: false, pointsAdded: 0, newTotal: 0, error: 'Sign in required.' };
    }

    const currentPoints = activeUser.stats.rewardPoints || 0;
    if (claimInFlightRef.current) {
      return {
        success: false,
        pointsAdded: 0,
        newTotal: currentPoints,
        remainingMs: getDailyClaimRemainingMs(activeUser),
        error: 'Claim already in progress.',
      };
    }

    const prevClaimAt = Math.max(
      Number(activeUser.lastDailyClaimAt || 0),
      readLocalDailyClaimAt(activeUser.id)
    );
    const nowMs = Date.now();
    if (prevClaimAt > 0 && nowMs - prevClaimAt < DAILY_CLAIM_COOLDOWN_MS) {
      const remainingMs = DAILY_CLAIM_COOLDOWN_MS - (nowMs - prevClaimAt);
      if ((activeUser.lastDailyClaimAt || 0) < prevClaimAt) {
        const synced = { ...activeUser, lastDailyClaimAt: prevClaimAt };
        setCurrentUser(synced);
        if (typeof window !== 'undefined') {
          localStorage.setItem(LS_CURRENT_USER, JSON.stringify(synced));
        }
      }
      return {
        success: false,
        pointsAdded: 0,
        newTotal: currentPoints,
        remainingMs,
        error: 'Already claimed within the last 24 hours.',
      };
    }

    claimInFlightRef.current = true;
    const pointsToAdd = 50;

    try {
      const cloudRes = await claimCloudDailyReward(
        {
          ...activeUser,
          ...(prevClaimAt > 0 ? { lastDailyClaimAt: prevClaimAt } : {}),
        },
        pointsToAdd
      );

      if (!cloudRes.allowed) {
        writeLocalDailyClaimAt(activeUser.id, cloudRes.lastDailyClaimAt);
        const syncedUser: UserProfile = {
          ...activeUser,
          lastDailyClaimAt: cloudRes.lastDailyClaimAt,
          stats: {
            ...activeUser.stats,
            rewardPoints: cloudRes.rewardPoints,
            streakDays: cloudRes.streakDays,
          },
        };
        setCurrentUser(syncedUser);
        setRegisteredProfiles((prev) =>
          prev.map((p) => (p.id === syncedUser.id ? syncedUser : p))
        );
        if (typeof window !== 'undefined') {
          localStorage.setItem(LS_CURRENT_USER, JSON.stringify(syncedUser));
        }
        return {
          success: false,
          pointsAdded: 0,
          newTotal: cloudRes.rewardPoints,
          remainingMs: getDailyClaimRemainingMs(cloudRes.lastDailyClaimAt),
          error: 'Already claimed within the last 24 hours.',
        };
      }

      const claimTs = cloudRes.lastDailyClaimAt;
      const nowIso = new Date(claimTs).toISOString();
      writeLocalDailyClaimAt(activeUser.id, claimTs);

      const updated: UserProfile = {
        ...activeUser,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        lastDailyClaimAt: claimTs,
        stats: {
          ...activeUser.stats,
          rewardPoints: cloudRes.rewardPoints,
          streakDays: cloudRes.streakDays,
        },
      };

      setCurrentUser(updated);
      setRegisteredProfiles((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );

      if (typeof window !== 'undefined') {
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updated));
      }

      appendWalletTransaction({
        id: `tx_${claimTs}`,
        userId: updated.id,
        amount: pointsToAdd,
        type: 'daily_reward',
        description: `Daily Streak Bonus (Day ${cloudRes.streakDays})`,
        createdAt: 'Just now',
      });

      persistProfileRemotely(updated).catch(() => {});

      return {
        success: true,
        pointsAdded: pointsToAdd,
        newTotal: cloudRes.rewardPoints,
        remainingMs: DAILY_CLAIM_COOLDOWN_MS,
      };
    } finally {
      claimInFlightRef.current = false;
    }
  };

  const awardGameResult = async (
    params: AwardGameParams
  ): Promise<{ success: boolean; newTotal: number; pointsAdded: number }> => {
    if (!currentUser) {
      return { success: false, newTotal: 0, pointsAdded: 0 };
    }
    const safePoints = Math.min(500, Math.max(0, Math.floor(params.pointsEarned)));
    const newTotal = Math.min(1000000, (currentUser.stats.rewardPoints || 0) + safePoints);
    const isCountedMatch = params.outcome !== 'spin';
    const newGamesPlayed = (currentUser.stats.gamesPlayed || 0) + (isCountedMatch ? 1 : 0);
    const newGamesWon = (currentUser.stats.gamesWon || 0) + (params.outcome === 'win' ? 1 : 0);
    const nowIso = new Date().toISOString();

    const updated: UserProfile = {
      ...currentUser,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      stats: {
        ...currentUser.stats,
        rewardPoints: newTotal,
        gamesPlayed: newGamesPlayed,
        gamesWon: newGamesWon,
      },
    };

    setCurrentUser(updated);
    setRegisteredProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );

    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updated));
    }

    const matchRecord: MatchHistoryRecord = {
      id: `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      profileId: updated.id,
      playerName: updated.fullName,
      gameId: params.gameId,
      gameName: params.gameName,
      mode: params.mode,
      outcome: params.outcome,
      pointsEarned: safePoints,
      scoreSummary: params.scoreSummary,
      createdAt: nowIso,
    };

    appendLocalMatchHistory(matchRecord);

    if (safePoints > 0) {
      appendWalletTransaction({
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: updated.id,
        amount: safePoints,
        type: params.gameId === 'quiz' ? 'quiz_reward' : 'game_reward',
        description: `${params.gameName}: ${params.scoreSummary}`,
        createdAt: 'Just now',
      });
    }

    await Promise.all([
      updateCloudProfile(updated, { stats: updated.stats }).catch(() => {}),
      syncLeaderboardEntry(updated, params.gameId).catch(() => {}),
      recordCloudMatchHistory(matchRecord).catch(() => {}),
      persistProfileRemotely(updated).catch(() => {}),
    ]);

    return { success: true, newTotal, pointsAdded: safePoints };
  };

  const spendRewardPoints = (
    amount: number,
    description: string,
    type: WalletTransaction['type'] = 'tournament_entry'
  ): { success: boolean; newTotal: number; error?: string } => {
    if (!currentUser) {
      return { success: false, newTotal: 0, error: 'Sign in required.' };
    }
    const cost = Math.max(0, Math.floor(amount));
    const current = currentUser.stats.rewardPoints || 0;
    if (current < cost) {
      return { success: false, newTotal: current, error: 'Insufficient virtual points.' };
    }
    const newTotal = current - cost;
    const nowIso = new Date().toISOString();
    const updated: UserProfile = {
      ...currentUser,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      stats: {
        ...currentUser.stats,
        rewardPoints: newTotal,
      },
    };
    setCurrentUser(updated);
    setRegisteredProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updated));
    }
    appendWalletTransaction({
      id: `tx_${Date.now()}`,
      userId: updated.id,
      amount: -cost,
      type,
      description,
      createdAt: 'Just now',
    });
    updateCloudProfile(updated, { stats: updated.stats }).catch(() => {});
    syncLeaderboardEntry(updated).catch(() => {});
    persistProfileRemotely(updated).catch(() => {});
    return { success: true, newTotal };
  };

  const switchUser = (userId: string) => {
    const target = registeredProfiles.find((p) => p.id === userId);
    if (target && !isProfileExpired(target)) {
      const nowIso = new Date().toISOString();
      const updated: UserProfile = {
        ...target,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
      };
      setCurrentUser(updated);
      setRegisteredProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (typeof window !== 'undefined') {
        localStorage.removeItem(LS_LOGGED_OUT);
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(updated));
      }
      ensureCloudProfileSeeded(updated)
        .then(() => touchCloudLoginTimestamp(updated))
        .catch(() => {});
      persistProfileRemotely(updated).catch(() => {});
    }
  };

  const daysRemaining = useMemo(() => calculateDaysRemaining(currentUser), [currentUser]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        isAuthLoading,
        registeredProfiles,
        loginWithContact,
        registerUser,
        logout,
        removeSavedProfile,
        deleteOwnAccount,
        syncLocalFriendsCount,
        updateProfile,
        claimDailyReward,
        awardGameResult,
        spendRewardPoints,
        switchUser,
        syncServerProfiles,
        isExpired: isProfileExpired,
        daysRemaining,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

