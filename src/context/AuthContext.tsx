/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { UserProfile, GameId, MatchHistoryRecord, WalletTransaction } from '../types';
import { INITIAL_USER, INITIAL_FRIENDS } from '../services/mockData';
import { getSupabaseClient } from '../lib/supabase';
import {
  testFirestoreConnection,
  lookupCloudProfileByPhone,
  loginCloudProfileByPhone,
  registerOrRecognizeCloudProfile,
  updateCloudProfile,
  ensureCloudProfileSeeded,
  touchCloudLoginTimestamp,
  syncLeaderboardEntry,
  recordCloudMatchHistory,
} from '../lib/firebase';

export const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // 180 consecutive days (6 months)

export function normalizePhoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

export function isPhoneNumberMatch(a: string, b: string): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Match on last 10 digits when country code (+91, etc.) or leading 0 differs
  if (da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10)) return true;
  // Match on local phone numbers of length 7+
  if (da.length >= 7 && db.length >= 7 && (da.endsWith(db) || db.endsWith(da))) return true;
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
  registeredProfiles: UserProfile[];
  loginWithContact: (contactNumber: string) => Promise<{ success: boolean; error?: string; user?: UserProfile }>;
  registerUser: (
    contactNumber: string,
    fullName: string,
    address: string
  ) => Promise<{ success: boolean; error?: string; user?: UserProfile; isExisting?: boolean; message?: string }>;
  logout: () => void;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  claimDailyReward: () => { success: boolean; pointsAdded: number; newTotal: number };
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
export const LS_WALLET_TX = 'jit_wallet_transactions';
export const LS_MATCH_HISTORY = 'jit_match_history';

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [registeredProfiles, setRegisteredProfiles] = useState<UserProfile[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_PROFILES);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Auto-clean any accounts inactive for >180 days on initial boot
            return parsed.filter((p: UserProfile) => !isProfileExpired(p));
          }
        } catch (e) {
          console.error('Failed to parse cached profiles', e);
        }
      }
    }
    return [INITIAL_USER, ...INITIAL_FRIENDS];
  });

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    if (typeof window !== 'undefined') {
      const isExplicitlyLoggedOut = localStorage.getItem(LS_LOGGED_OUT) === 'true';
      if (isExplicitlyLoggedOut) {
        return null;
      }
      const saved = localStorage.getItem(LS_CURRENT_USER);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.id) {
            // If saved profile has exceeded 180 days, auto-clear and log out
            if (isProfileExpired(parsed)) {
              localStorage.removeItem(LS_CURRENT_USER);
              return null;
            }
            return parsed;
          }
        } catch (e) {
          console.error('Failed to parse cached current user', e);
        }
      }
    }
    return INITIAL_USER; // Default to demo user for instantaneous interactive exploration
  });

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

  // Sync profiles with shared cloud Firestore & backend server on startup
  const syncServerProfiles = useCallback(async () => {
    try {
      await testFirestoreConnection();

      // Verify & refresh current user directly from Firestore so edits/logins sync across devices
      if (currentUser && currentUser.contactNumber) {
        try {
          const cloudCurrent = await lookupCloudProfileByPhone(currentUser.contactNumber);
          if (cloudCurrent.expired) {
            setCurrentUser(null);
            setRegisteredProfiles((prev) => prev.filter((p) => p.id !== currentUser.id));
            if (typeof window !== 'undefined') {
              localStorage.removeItem(LS_CURRENT_USER);
            }
          } else if (cloudCurrent.found && cloudCurrent.profile) {
            const cloudProfile = cloudCurrent.profile;
            setCurrentUser((prev) =>
              prev ? { ...prev, ...cloudProfile } : cloudProfile
            );
          } else if (!isProfileExpired(currentUser)) {
            await ensureCloudProfileSeeded(currentUser);
          }
        } catch (cloudErr) {
          console.warn('Firestore current user sync notice:', cloudErr);
        }
      }

      // 1. Fetch server profiles from shared backend (accessible across all browsers/devices)
      const res = await fetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        const serverProfiles: UserProfile[] = data.profiles || [];
        const activeServerProfiles = serverProfiles.filter((p) => !isProfileExpired(p));

        setRegisteredProfiles((prev) => {
          const map = new Map<string, UserProfile>();
          // Add existing local state first (excluding expired)
          for (const p of prev) {
            if (!isProfileExpired(p)) {
              map.set(p.id, p);
            }
          }
          // Merge server profiles
          for (const sp of activeServerProfiles) {
            const localExisting = Array.from(map.values()).find(
              (p) => isPhoneNumberMatch(p.contactNumber, sp.contactNumber) || p.id === sp.id
            );
            if (localExisting) {
              // Keep max points and stats, and freshest login timestamp
              const freshestLoginAt =
                new Date(sp.lastLoginAt || sp.joinedAt).getTime() >
                new Date(localExisting.lastLoginAt || localExisting.joinedAt).getTime()
                  ? sp.lastLoginAt
                  : localExisting.lastLoginAt;
              map.set(localExisting.id, {
                ...localExisting,
                ...sp,
                id: localExisting.id,
                lastLoginAt: freshestLoginAt,
                lastLogin: freshestLoginAt,
                stats: {
                  ...localExisting.stats,
                  ...sp.stats,
                  rewardPoints: Math.max(localExisting.stats?.rewardPoints ?? 0, sp.stats?.rewardPoints ?? 0),
                  gamesPlayed: Math.max(localExisting.stats?.gamesPlayed ?? 0, sp.stats?.gamesPlayed ?? 0),
                  gamesWon: Math.max(localExisting.stats?.gamesWon ?? 0, sp.stats?.gamesWon ?? 0),
                  streakDays: Math.max(localExisting.stats?.streakDays ?? 1, sp.stats?.streakDays ?? 1),
                },
              });
            } else {
              map.set(sp.id, sp);
            }
          }
          const merged = Array.from(map.values()).filter((p) => !isProfileExpired(p));
          if (typeof window !== 'undefined') {
            localStorage.setItem(LS_PROFILES, JSON.stringify(merged));
          }
          return merged;
        });

        // If current user is recognized on server and server copy is fresher, merge without losing cloud edits
        if (currentUser) {
          const matchedServer = activeServerProfiles.find(
            (p) => p.id === currentUser.id || isPhoneNumberMatch(p.contactNumber, currentUser.contactNumber)
          );
          if (matchedServer) {
            setCurrentUser((prev) => {
              if (!prev) return matchedServer;
              const serverTs = new Date(matchedServer.lastLoginAt || matchedServer.joinedAt || 0).getTime();
              const prevTs = new Date(prev.lastLoginAt || prev.joinedAt || 0).getTime();
              const base = serverTs > prevTs ? { ...prev, ...matchedServer } : { ...matchedServer, ...prev };
              return {
                ...base,
                stats: {
                  ...base.stats,
                  rewardPoints: Math.max(prev.stats?.rewardPoints ?? 0, matchedServer.stats?.rewardPoints ?? 0),
                  gamesPlayed: Math.max(prev.stats?.gamesPlayed ?? 0, matchedServer.stats?.gamesPlayed ?? 0),
                  gamesWon: Math.max(prev.stats?.gamesWon ?? 0, matchedServer.stats?.gamesWon ?? 0),
                  streakDays: Math.max(prev.stats?.streakDays ?? 1, matchedServer.stats?.streakDays ?? 1),
                },
              };
            });
          }
        }
      }

      // 2. Backup valid local profiles to shared cloud backend & Firestore
      const nonExpired = registeredProfiles.filter((p) => !isProfileExpired(p));
      if (nonExpired.length > 0) {
        for (const p of nonExpired) {
          ensureCloudProfileSeeded(p).catch(() => {});
        }
        await fetch('/api/profiles/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profiles: nonExpired }),
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('Initial server profiles sync notice:', err);
    }
  }, [currentUser, registeredProfiles]);

  useEffect(() => {
    syncServerProfiles();
    // Run periodic sync & 180-day cleanup sweep every 10 minutes in the background
    const interval = setInterval(() => {
      syncServerProfiles();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // Run on mount

  // Helper to persist profile to shared backend server and Supabase (if configured)
  const persistProfileRemotely = async (profile: UserProfile) => {
    const nowIso = new Date().toISOString();
    const profileToPersist: UserProfile = {
      ...profile,
      lastLoginAt: profile.lastLoginAt || nowIso,
      lastLogin: profile.lastLogin || profile.lastLoginAt || nowIso,
    };

    // 1. Backend Server Persistence (shared mirror)
    try {
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileToPersist),
      });
    } catch (e) {
      console.warn('Failed to persist profile to server endpoint:', e);
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

    // 2. Try server login endpoint
    try {
      const serverRes = await fetch('/api/profiles/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactNumber }),
      });
      if (serverRes.ok) {
        const data = await serverRes.json();
        if (data.success && data.profile) {
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
      }
    } catch (e) {
      console.warn('Backend login endpoint notice, attempting lookup:', e);
    }

    // 3. Check local registered profiles
    let matched = registeredProfiles.find((p) => isPhoneNumberMatch(p.contactNumber, contactNumber));

    // 4. If not found locally, query server API
    if (!matched) {
      try {
        const res = await fetch(`/api/profiles/lookup/${encodeURIComponent(contactNumber.trim())}`);
        if (res.ok) {
          const data = await res.json();
          if (data.found && data.profile) {
            matched = data.profile;
          }
        }
      } catch (e) {
        console.warn('Server lookup error:', e);
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

    if (!matched) {
      return {
        success: false,
        error: `No active account found for "${contactNumber}". Please register a new profile below.`,
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

    if (!seedCandidate) {
      try {
        const res = await fetch(`/api/profiles/lookup/${encodeURIComponent(contactNumber.trim())}`);
        if (res.ok) {
          const data = await res.json();
          if (data.found && data.profile && !isProfileExpired(data.profile)) {
            seedCandidate = data.profile;
          }
        }
      } catch (e) {
        console.warn('Server lookup error during register:', e);
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
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!currentUser) return;
    const nowIso = new Date().toISOString();
    const updated: UserProfile = {
      ...currentUser,
      ...updates,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      // Retain max stats & points
      stats: {
        ...currentUser.stats,
        ...(updates.stats || {}),
        rewardPoints: updates.stats?.rewardPoints ?? currentUser.stats.rewardPoints,
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
      updateCloudProfile(updated, updates).catch(() => {}),
      syncLeaderboardEntry(updated).catch(() => {}),
      persistProfileRemotely(updated).catch(() => {}),
    ]);
  };

  const claimDailyReward = (): { success: boolean; pointsAdded: number; newTotal: number } => {
    if (!currentUser) return { success: false, pointsAdded: 0, newTotal: 0 };
    const pointsToAdd = 50;
    const newTotal = (currentUser.stats.rewardPoints || 0) + pointsToAdd;
    const newStreak = (currentUser.stats.streakDays || 0) + 1;
    const nowIso = new Date().toISOString();

    const updated: UserProfile = {
      ...currentUser,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      stats: {
        ...currentUser.stats,
        rewardPoints: newTotal,
        streakDays: newStreak,
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
      id: `tx_${Date.now()}`,
      userId: updated.id,
      amount: pointsToAdd,
      type: 'daily_reward',
      description: `Daily Streak Bonus (Day ${newStreak})`,
      createdAt: 'Just now',
    });

    updateCloudProfile(updated, { stats: updated.stats }).catch(() => {});
    syncLeaderboardEntry(updated).catch(() => {});
    persistProfileRemotely(updated).catch(() => {});

    return { success: true, pointsAdded: pointsToAdd, newTotal };
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
        registeredProfiles,
        loginWithContact,
        registerUser,
        logout,
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

