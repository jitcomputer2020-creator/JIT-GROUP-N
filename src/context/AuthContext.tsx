/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { INITIAL_USER, INITIAL_FRIENDS } from '../services/mockData';
import { getSupabaseClient } from '../lib/supabase';

interface AuthContextType {
  currentUser: UserProfile | null;
  isAuthenticated: boolean;
  registeredProfiles: UserProfile[];
  loginWithContact: (contactNumber: string) => Promise<{ success: boolean; error?: string; user?: UserProfile }>;
  registerUser: (contactNumber: string, fullName: string, address: string) => Promise<{ success: boolean; error?: string; user?: UserProfile }>;
  logout: () => void;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  claimDailyReward: () => { success: boolean; pointsAdded: number; newTotal: number };
  switchUser: (userId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LS_CURRENT_USER = 'jit_current_user';
const LS_PROFILES = 'jit_registered_profiles';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [registeredProfiles, setRegisteredProfiles] = useState<UserProfile[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_PROFILES);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse cached profiles', e);
        }
      }
    }
    return [INITIAL_USER, ...INITIAL_FRIENDS];
  });

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_CURRENT_USER);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse cached current user', e);
        }
      }
    }
    return INITIAL_USER; // Default to demo user for instantaneous interactive exploration
  });

  // Sync to local storage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentUser) {
        localStorage.setItem(LS_CURRENT_USER, JSON.stringify(currentUser));
      } else {
        localStorage.removeItem(LS_CURRENT_USER);
      }
      localStorage.setItem(LS_PROFILES, JSON.stringify(registeredProfiles));
    }
  }, [currentUser, registeredProfiles]);

  const normalizePhone = (phone: string) => phone.replace(/[\s\-\(\)]/g, '').trim();

  // Login via Contact Number lookup
  const loginWithContact = async (contactNumber: string): Promise<{ success: boolean; error?: string; user?: UserProfile }> => {
    const cleanNumber = normalizePhone(contactNumber);
    if (!cleanNumber || cleanNumber.length < 7) {
      return { success: false, error: 'Please enter a valid contact number (at least 7 digits).' };
    }

    // Try Supabase if configured
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('contact_number', cleanNumber)
          .maybeSingle();

        if (error) {
          console.warn('Supabase profile query failed, checking local profiles:', error.message);
        } else if (data) {
          const userObj: UserProfile = {
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

          // Update last_login_at in Supabase for 180-day inactivity tracking
          await supabase
            .from('profiles')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', userObj.id);

          setCurrentUser(userObj);
          return { success: true, user: userObj };
        }
      } catch (err) {
        console.warn('Supabase lookup error:', err);
      }
    }

    // Fallback: check local profiles
    const matched = registeredProfiles.find(
      (p) => normalizePhone(p.contactNumber) === cleanNumber
    );

    if (!matched) {
      return {
        success: false,
        error: `No account found for ${contactNumber}. Please register a new profile below.`,
      };
    }

    const updatedUser: UserProfile = {
      ...matched,
      lastLoginAt: new Date().toISOString(),
    };

    setCurrentUser(updatedUser);
    setRegisteredProfiles((prev) =>
      prev.map((p) => (p.id === updatedUser.id ? updatedUser : p))
    );

    return { success: true, user: updatedUser };
  };

  // Register via Contact Number
  const registerUser = async (
    contactNumber: string,
    fullName: string,
    address: string
  ): Promise<{ success: boolean; error?: string; user?: UserProfile }> => {
    const cleanNumber = normalizePhone(contactNumber);
    if (!cleanNumber || cleanNumber.length < 7) {
      return { success: false, error: 'Please enter a valid contact number (at least 7 digits).' };
    }
    if (!fullName.trim()) {
      return { success: false, error: 'Full Name is required.' };
    }
    if (!address.trim()) {
      return { success: false, error: 'Address or Campus location is required.' };
    }

    // Check duplicate
    const exists = registeredProfiles.some(
      (p) => normalizePhone(p.contactNumber) === cleanNumber
    );
    if (exists) {
      return {
        success: false,
        error: 'This contact number is already registered. Please use the Login tab instead.',
      };
    }

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
        rewardPoints: 100, // Welcome points
        streakDays: 1,
      },
    };

    // Attempt Supabase insert if configured
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('profiles').insert({
          id: newProfile.id,
          contact_number: cleanNumber,
          full_name: newProfile.fullName,
          address: newProfile.address,
          bio: newProfile.bio,
          avatar_url: newProfile.avatarUrl,
          created_at: nowIso,
          last_login_at: nowIso,
          is_contact_number_public: false,
          is_address_public: false,
          reward_points: 100,
          streak_days: 1,
        });
      } catch (err) {
        console.warn('Supabase profile insertion error (cached locally):', err);
      }
    }

    setRegisteredProfiles((prev) => [newProfile, ...prev]);
    setCurrentUser(newProfile);

    return { success: true, user: newProfile };
  };

  const logout = () => {
    setCurrentUser(null);
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!currentUser) return;
    const updated = { ...currentUser, ...updates };
    setCurrentUser(updated);
    setRegisteredProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('profiles')
          .update({
            full_name: updated.fullName,
            bio: updated.bio,
            address: updated.address,
            avatar_url: updated.avatarUrl,
            cover_url: updated.coverUrl,
            is_contact_number_public: updated.isContactNumberPublic,
            is_address_public: updated.isAddressPublic,
          })
          .eq('id', updated.id);
      } catch (err) {
        console.warn('Supabase update failed:', err);
      }
    }
  };

  const claimDailyReward = (): { success: boolean; pointsAdded: number; newTotal: number } => {
    if (!currentUser) return { success: false, pointsAdded: 0, newTotal: 0 };
    const pointsToAdd = 50;
    const newTotal = currentUser.stats.rewardPoints + pointsToAdd;
    const newStreak = currentUser.stats.streakDays + 1;

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

    return { success: true, pointsAdded: pointsToAdd, newTotal };
  };

  const switchUser = (userId: string) => {
    const target = registeredProfiles.find((p) => p.id === userId);
    if (target) {
      setCurrentUser(target);
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
