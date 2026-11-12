/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { INITIAL_USER, INITIAL_FRIENDS } from '../services/mockData';
import { getSupabaseClient } from '../lib/supabase';

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
  switchUser: (userId: string) => void;
  syncServerProfiles: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LS_CURRENT_USER = 'jit_current_user';
const LS_PROFILES = 'jit_registered_profiles';
const LS_LOGGED_OUT = 'jit_logged_out';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [registeredProfiles, setRegisteredProfiles] = useState<UserProfile[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_PROFILES);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
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
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(currentUser));
        localStorage.removeItem(LS_LOGGED_OUT);
      } else {
        localStorage.removeItem(LS_CURRENT_USER);
      }
      localStorage.setItem(LS_PROFILES, JSON.stringify(registeredProfiles));
    }
  }, [currentUser, registeredProfiles]);

  // Sync profiles with backend server on startup and restore any server-saved accounts
  const syncServerProfiles = useCallback(async () => {
    try {
      // 1. Fetch server profiles
      const res = await fetch('/api/profiles');
      if (res.ok) {
        const data = await res.json();
        const serverProfiles: UserProfile[] = data.profiles || [];
        if (serverProfiles.length > 0) {
          setRegisteredProfiles((prev) => {
            const map = new Map<string, UserProfile>();
            // Add existing state first
            for (const p of prev) {
              map.set(p.id, p);
            }
            // Merge server profiles
            for (const sp of serverProfiles) {
              const localExisting = Array.from(map.values()).find(
                (p) => isPhoneNumberMatch(p.contactNumber, sp.contactNumber) || p.id === sp.id
              );
              if (localExisting) {
                // Keep max points and stats
                map.set(localExisting.id, {
                  ...localExisting,
                  ...sp,
                  id: localExisting.id,
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
            const merged = Array.from(map.values());
            if (typeof window !== 'undefined') {
              localStorage.setItem(LS_PROFILES, JSON.stringify(merged));
            }
            return merged;
          });
        }
      }

      // 2. Also backup local profiles to server
      if (registeredProfiles.length > 0) {
        await fetch('/api/profiles/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profiles: registeredProfiles }),
        }).catch(() => {});
      }
    } catch (err) {
      // Backend sync error is non-blocking (offline or initial boot)
      console.warn('Initial server profiles sync notice:', err);
    }
  }, [registeredProfiles]);

  useEffect(() => {
    syncServerProfiles();
  }, []); // Run on mount

  // Helper to persist profile both to server and Supabase (if configured)
  const persistProfileRemotely = async (profile: UserProfile) => {
    // 1. Backend Server Persistence
    try {
      await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
    } catch (e) {
      console.warn('Failed to persist profile to server endpoint:', e);
    }

    // 2. Supabase if credentials are provided
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('profiles').upsert({
          id: profile.id,
          contact_number: normalizePhoneDigits(profile.contactNumber),
          full_name: profile.fullName,
          address: profile.address,
          bio: profile.bio,
          avatar_url: profile.avatarUrl,
          cover_url: profile.coverUrl,
          created_at: profile.joinedAt,
          last_login_at: profile.lastLoginAt,
          is_contact_number_public: profile.isContactNumberPublic,
          is_address_public: profile.isAddressPublic,
          reward_points: profile.stats.rewardPoints,
          streak_days: profile.stats.streakDays,
        });
      } catch (err) {
        console.warn('Supabase upsert notice:', err);
      }
    }
  };

  // Login via Contact Number lookup
  const loginWithContact = async (
    contactNumber: string
  ): Promise<{ success: boolean; error?: string; user?: UserProfile }> => {
    const digits = normalizePhoneDigits(contactNumber);
    if (!digits || digits.length < 7) {
      return { success: false, error: 'Please enter a valid contact number (at least 7 digits).' };
    }

    // 1. Check local registered profiles first
    let matched = registeredProfiles.find((p) => isPhoneNumberMatch(p.contactNumber, contactNumber));

    // 2. If not found locally, query server API
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

    // 3. If not found on server, query Supabase if available
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
              joinedAt: data.created_at || new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
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
        error: `No account found for "${contactNumber}". Please register a new profile below.`,
      };
    }

    // User found! Update login timestamp without clearing user points or state
    const updatedUser: UserProfile = {
      ...matched,
      lastLoginAt: new Date().toISOString(),
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

    // Persist login timestamp asynchronously
    persistProfileRemotely(updatedUser);

    return { success: true, user: updatedUser };
  };

  // Register via Contact Number
  // CRITICAL REQUIREMENT: If user enters an already registered number, DO NOT wipe or reset data!
  // Instead, seamlessly recognize the user, preserve all their reward points and stats, and log them in.
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

    // 1. Check if user already exists locally
    let existingProfile = registeredProfiles.find((p) => isPhoneNumberMatch(p.contactNumber, contactNumber));

    // 2. Check if user exists on server
    if (!existingProfile) {
      try {
        const res = await fetch(`/api/profiles/lookup/${encodeURIComponent(contactNumber.trim())}`);
        if (res.ok) {
          const data = await res.json();
          if (data.found && data.profile) {
            existingProfile = data.profile;
          }
        }
      } catch (e) {
        console.warn('Server lookup error during register:', e);
      }
    }

    // 3. Check Supabase
    if (!existingProfile) {
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('contact_number', digits)
            .maybeSingle();
          if (data) {
            existingProfile = {
              id: data.id,
              contactNumber: data.contact_number,
              fullName: data.full_name,
              address: data.address || address.trim(),
              bio: data.bio || '',
              avatarUrl: data.avatar_url || '/assets/aistudio/image_e64e54f2.png',
              coverUrl: data.cover_url,
              joinedAt: data.created_at || new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
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
        } catch (e) {
          console.warn('Supabase lookup error during register:', e);
        }
      }
    }

    if (existingProfile) {
      // EXISTING USER RECOGNIZED:
      // Do NOT delete, wipe, or overwrite existing earned points, games won, or profile ID!
      const recognizedUser: UserProfile = {
        ...existingProfile,
        fullName: fullName.trim() || existingProfile.fullName,
        address: address.trim() || existingProfile.address,
        lastLoginAt: new Date().toISOString(),
        // Safeguard points and stats:
        stats: {
          ...existingProfile.stats,
          rewardPoints: Math.max(existingProfile.stats?.rewardPoints ?? 100, 100),
          streakDays: Math.max(existingProfile.stats?.streakDays ?? 1, 1),
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

      persistProfileRemotely(recognizedUser);

      return {
        success: true,
        user: recognizedUser,
        isExisting: true,
        message: `Welcome back, ${recognizedUser.fullName}! Existing profile recognized without data loss.`,
      };
    }

    // BRAND NEW USER REGISTRATION:
    const newId = `usr_jit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const newProfile: UserProfile = {
      id: newId,
      contactNumber: contactNumber.trim(),
      fullName: fullName.trim(),
      address: address.trim(),
      bio: 'Proud member of JIT GROUP campus community.',
      avatarUrl: '/assets/aistudio/image_e64e54f2.png',
      joinedAt: nowIso,
      lastLoginAt: nowIso,
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

    setRegisteredProfiles((prev) => [newProfile, ...prev]);
    setCurrentUser(newProfile);

    if (typeof window !== 'undefined') {
      localStorage.removeItem(LS_LOGGED_OUT);
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(newProfile));
    }

    persistProfileRemotely(newProfile);

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
    const updated: UserProfile = {
      ...currentUser,
      ...updates,
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

    persistProfileRemotely(updated);
  };

  const claimDailyReward = (): { success: boolean; pointsAdded: number; newTotal: number } => {
    if (!currentUser) return { success: false, pointsAdded: 0, newTotal: 0 };
    const pointsToAdd = 50;
    const newTotal = (currentUser.stats.rewardPoints || 0) + pointsToAdd;
    const newStreak = (currentUser.stats.streakDays || 0) + 1;

    const updated: UserProfile = {
      ...currentUser,
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

    persistProfileRemotely(updated);

    return { success: true, pointsAdded: pointsToAdd, newTotal };
  };

  const switchUser = (userId: string) => {
    const target = registeredProfiles.find((p) => p.id === userId);
    if (target) {
      setCurrentUser(target);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(LS_LOGGED_OUT);
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(target));
      }
    }
  };

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
        switchUser,
        syncServerProfiles,
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

