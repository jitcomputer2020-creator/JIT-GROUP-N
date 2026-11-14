/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Server-Side Firestore REST Client (firebase/firestore/lite)
 * Uses stateless HTTPS REST requests instead of Node gRPC persistent Watch/Listen
 * streams, preventing GrpcConnection RPC 'Listen' stream ECONNRESET errors in Node.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  collection,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore/lite';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile, LeaderboardEntry, MatchHistoryRecord, GameId } from '../types';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const dbLite = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000;

export function normalizeDigitsOnly(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

export function toCanonicalPhoneKey(phone: string): string {
  const digits = normalizeDigitsOnly(phone);
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

function isCloudTimestampExpired(ts: unknown, fallbackIso?: string): boolean {
  if (ts && typeof (ts as Timestamp).toMillis === 'function') {
    return Date.now() - (ts as Timestamp).toMillis() > INACTIVITY_EXPIRY_MS;
  }
  if (fallbackIso) {
    const ms = Date.parse(fallbackIso);
    if (!isNaN(ms)) {
      return Date.now() - ms > INACTIVITY_EXPIRY_MS;
    }
  }
  return false;
}

function sanitizeAvatarUrl(url?: string): string {
  if (!url) return '/assets/aistudio/image_e64e54f2.png';
  if (url.length > 380000) return '/assets/aistudio/image_e64e54f2.png';
  return url;
}

function sanitizeStats(stats?: Partial<UserProfile['stats']>): UserProfile['stats'] {
  return {
    friendsCount: Math.max(0, Math.floor(Number(stats?.friendsCount ?? 0))),
    followersCount: Math.max(0, Math.floor(Number(stats?.followersCount ?? 0))),
    followingCount: Math.max(0, Math.floor(Number(stats?.followingCount ?? 0))),
    postsCount: Math.max(0, Math.floor(Number(stats?.postsCount ?? 0))),
    reelsCount: Math.max(0, Math.floor(Number(stats?.reelsCount ?? 0))),
    gamesPlayed: Math.max(0, Math.floor(Number(stats?.gamesPlayed ?? 0))),
    gamesWon: Math.max(0, Math.floor(Number(stats?.gamesWon ?? 0))),
    rewardPoints: Math.min(1000000, Math.max(0, Math.floor(Number(stats?.rewardPoints ?? 100)))),
    streakDays: Math.max(0, Math.floor(Number(stats?.streakDays ?? 1))),
  };
}

function firestoreDocToUserProfile(data: Record<string, any>): UserProfile {
  const lastLoginIso =
    (data.lastActiveAt && typeof data.lastActiveAt.toDate === 'function'
      ? data.lastActiveAt.toDate().toISOString()
      : undefined) ||
    data.lastLoginAt ||
    data.lastLogin ||
    data.joinedAt ||
    new Date().toISOString();

  return {
    id: String(data.id),
    contactNumber: String(data.contactNumber || ''),
    fullName: String(data.fullName || 'JIT Member'),
    address: String(data.address || ''),
    bio: typeof data.bio === 'string' ? data.bio : '',
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '/assets/aistudio/image_e64e54f2.png',
    coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
    joinedAt: String(data.joinedAt || lastLoginIso),
    lastLoginAt: String(data.lastLoginAt || lastLoginIso),
    lastLogin: String(data.lastLogin || data.lastLoginAt || lastLoginIso),
    isContactNumberPublic: Boolean(data.isContactNumberPublic),
    isAddressPublic: Boolean(data.isAddressPublic),
    stats: sanitizeStats(data.stats),
  };
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDoc(doc(dbLite, 'test', 'connection'));
  } catch {
    // Non-fatal connection probe
  }
}

async function cleanupExpiredCloudProfile(phoneKey: string, profileId: string): Promise<void> {
  try {
    const batch = writeBatch(dbLite);
    batch.delete(doc(dbLite, 'phone_index', phoneKey));
    batch.delete(doc(dbLite, 'profiles', profileId));
    await batch.commit();
  } catch (err) {
    console.warn('Expired profile cloud cleanup notice:', err);
  }
}

export async function lookupCloudProfileByPhone(
  contactNumber: string
): Promise<{ found: boolean; profile?: UserProfile; expired?: boolean }> {
  const phoneKey = toCanonicalPhoneKey(contactNumber);
  if (!phoneKey || phoneKey.length < 7) return { found: false };

  const indexSnap = await getDoc(doc(dbLite, 'phone_index', phoneKey));
  if (!indexSnap.exists()) return { found: false };

  const indexData = indexSnap.data();
  const profileId = indexData?.profileId;
  if (!profileId || typeof profileId !== 'string') return { found: false };

  if (isCloudTimestampExpired(indexData.lastLoginAt)) {
    await cleanupExpiredCloudProfile(phoneKey, profileId);
    return { found: false, expired: true };
  }

  const profileSnap = await getDoc(doc(dbLite, 'profiles', profileId));
  if (!profileSnap.exists()) return { found: false };

  const profileData = profileSnap.data();
  if (
    profileId !== 'usr_jit_primary_001' &&
    isCloudTimestampExpired(profileData.lastActiveAt, profileData.lastLoginAt || profileData.lastLogin)
  ) {
    await cleanupExpiredCloudProfile(phoneKey, profileId);
    return { found: false, expired: true };
  }

  return { found: true, profile: firestoreDocToUserProfile(profileData) };
}

export async function loginCloudProfileByPhone(
  contactNumber: string
): Promise<{ success: boolean; profile?: UserProfile; expired?: boolean }> {
  const lookup = await lookupCloudProfileByPhone(contactNumber);
  if (!lookup.found || !lookup.profile) {
    return { success: false, expired: lookup.expired };
  }

  const profile = lookup.profile;
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber || contactNumber);
  const nowIso = new Date().toISOString();

  const batch = writeBatch(dbLite);
  batch.update(doc(dbLite, 'profiles', profile.id), {
    lastLoginAt: nowIso,
    lastLogin: nowIso,
    lastActiveAt: serverTimestamp(),
  });
  batch.update(doc(dbLite, 'phone_index', phoneKey), {
    lastLoginAt: serverTimestamp(),
  });
  await batch.commit();

  return {
    success: true,
    profile: { ...profile, lastLoginAt: nowIso, lastLogin: nowIso },
  };
}

export async function syncNodeLeaderboardEntry(profile: UserProfile, lastGameId?: string): Promise<void> {
  if (!profile?.id) return;
  try {
    const stats = sanitizeStats(profile.stats);
    await setDoc(doc(dbLite, 'leaderboard', profile.id), {
      profileId: profile.id,
      fullName: (profile.fullName || 'JIT Member').trim().slice(0, 120),
      avatarUrl: sanitizeAvatarUrl(profile.avatarUrl),
      rewardPoints: stats.rewardPoints,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
      streakDays: stats.streakDays,
      ...(lastGameId ? { lastGameId: String(lastGameId).slice(0, 32) } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Leaderboard sync notice (node):', err);
  }
}

export async function registerOrRecognizeCloudProfile(
  contactNumber: string,
  fullName: string,
  address: string,
  seedProfile?: UserProfile
): Promise<{ success: boolean; profile: UserProfile; isExisting: boolean }> {
  const phoneKey = toCanonicalPhoneKey(contactNumber);
  const nowIso = new Date().toISOString();

  const existing = await lookupCloudProfileByPhone(contactNumber);
  if (existing.found && existing.profile) {
    const prev = existing.profile;
    const cleanName = fullName.trim().slice(0, 120) || prev.fullName;
    const cleanAddr = address.trim().slice(0, 300) || prev.address;

    const batch = writeBatch(dbLite);
    batch.update(doc(dbLite, 'profiles', prev.id), {
      fullName: cleanName,
      address: cleanAddr,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    });
    batch.update(doc(dbLite, 'phone_index', phoneKey), {
      lastLoginAt: serverTimestamp(),
    });
    await batch.commit();

    const updated = {
      ...prev,
      fullName: cleanName,
      address: cleanAddr,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
    };
    await syncNodeLeaderboardEntry(updated);
    return { success: true, isExisting: true, profile: updated };
  }

  const profileId =
    seedProfile?.id || `usr_jit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const newProfile: UserProfile = {
    id: profileId,
    contactNumber: (seedProfile?.contactNumber || contactNumber).trim().slice(0, 30),
    fullName: (seedProfile?.fullName || fullName).trim().slice(0, 120),
    address: (seedProfile?.address || address).trim().slice(0, 300),
    bio: (seedProfile?.bio || 'Proud member of JIT GROUP campus community.').slice(0, 500),
    avatarUrl: sanitizeAvatarUrl(seedProfile?.avatarUrl),
    ...(seedProfile?.coverUrl && seedProfile.coverUrl.length <= 380000
      ? { coverUrl: seedProfile.coverUrl }
      : {}),
    joinedAt: seedProfile?.joinedAt || nowIso,
    lastLoginAt: nowIso,
    lastLogin: nowIso,
    isContactNumberPublic: Boolean(seedProfile?.isContactNumberPublic),
    isAddressPublic: Boolean(seedProfile?.isAddressPublic),
    stats: sanitizeStats(seedProfile?.stats || { rewardPoints: 100, streakDays: 1 }),
  };

  const firestoreProfileDoc: Record<string, any> = {
    id: newProfile.id,
    contactNumber: newProfile.contactNumber,
    phoneKey,
    fullName: newProfile.fullName,
    address: newProfile.address,
    bio: newProfile.bio || '',
    avatarUrl: newProfile.avatarUrl,
    joinedAt: newProfile.joinedAt,
    lastLoginAt: newProfile.lastLoginAt,
    lastLogin: newProfile.lastLogin,
    lastActiveAt: serverTimestamp(),
    isContactNumberPublic: Boolean(newProfile.isContactNumberPublic),
    isAddressPublic: Boolean(newProfile.isAddressPublic),
    stats: newProfile.stats,
  };
  if (newProfile.coverUrl) {
    firestoreProfileDoc.coverUrl = newProfile.coverUrl;
  }

  const batch = writeBatch(dbLite);
  batch.set(doc(dbLite, 'profiles', newProfile.id), firestoreProfileDoc);
  batch.set(doc(dbLite, 'phone_index', phoneKey), {
    profileId: newProfile.id,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });
  batch.set(doc(dbLite, 'leaderboard', newProfile.id), {
    profileId: newProfile.id,
    fullName: newProfile.fullName,
    avatarUrl: newProfile.avatarUrl,
    rewardPoints: newProfile.stats.rewardPoints,
    gamesPlayed: newProfile.stats.gamesPlayed,
    gamesWon: newProfile.stats.gamesWon,
    streakDays: newProfile.stats.streakDays,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();

  return { success: true, isExisting: false, profile: newProfile };
}

export async function updateCloudProfile(
  profile: UserProfile,
  updates: Partial<UserProfile>
): Promise<void> {
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  if (!phoneKey || phoneKey.length < 7) return;

  const nowIso = new Date().toISOString();
  const profileRef = doc(dbLite, 'profiles', profile.id);
  const indexRef = doc(dbLite, 'phone_index', phoneKey);

  const existingSnap = await getDoc(profileRef);
  if (!existingSnap.exists()) {
    await registerOrRecognizeCloudProfile(
      profile.contactNumber,
      profile.fullName,
      profile.address,
      profile
    );
    return;
  }

  const detailKeys = [
    'fullName',
    'bio',
    'address',
    'avatarUrl',
    'coverUrl',
    'isContactNumberPublic',
    'isAddressPublic',
  ] as const;
  const hasDetailUpdates = detailKeys.some((k) => updates[k] !== undefined);
  const hasStatsUpdate = updates.stats !== undefined;

  if (!hasDetailUpdates && !hasStatsUpdate) {
    const batch = writeBatch(dbLite);
    batch.update(profileRef, { lastLoginAt: nowIso, lastLogin: nowIso, lastActiveAt: serverTimestamp() });
    batch.update(indexRef, { lastLoginAt: serverTimestamp() });
    await batch.commit();
    return;
  }

  if (hasDetailUpdates) {
    const detailPatch: Record<string, any> = {
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    };
    if (updates.fullName !== undefined) detailPatch.fullName = updates.fullName.trim().slice(0, 120);
    if (updates.bio !== undefined) detailPatch.bio = updates.bio.slice(0, 500);
    if (updates.address !== undefined) detailPatch.address = updates.address.trim().slice(0, 300);
    if (updates.avatarUrl !== undefined) detailPatch.avatarUrl = sanitizeAvatarUrl(updates.avatarUrl);
    if (updates.coverUrl !== undefined && updates.coverUrl.length <= 380000) {
      detailPatch.coverUrl = updates.coverUrl;
    }
    if (updates.isContactNumberPublic !== undefined) {
      detailPatch.isContactNumberPublic = Boolean(updates.isContactNumberPublic);
    }
    if (updates.isAddressPublic !== undefined) {
      detailPatch.isAddressPublic = Boolean(updates.isAddressPublic);
    }

    const batch = writeBatch(dbLite);
    batch.update(profileRef, detailPatch);
    batch.update(indexRef, { lastLoginAt: serverTimestamp() });
    await batch.commit();
  }

  if (hasStatsUpdate) {
    const batch = writeBatch(dbLite);
    batch.update(profileRef, {
      stats: sanitizeStats(updates.stats),
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    });
    batch.update(indexRef, { lastLoginAt: serverTimestamp() });
    await batch.commit();
  }

  await syncNodeLeaderboardEntry(profile);
}

export async function ensureCloudProfileSeeded(profile: UserProfile): Promise<void> {
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  if (!phoneKey || phoneKey.length < 7) return;
  try {
    const existing = await getDoc(doc(dbLite, 'phone_index', phoneKey));
    if (!existing.exists()) {
      await registerOrRecognizeCloudProfile(
        profile.contactNumber,
        profile.fullName,
        profile.address,
        profile
      );
    } else {
      const lbSnap = await getDoc(doc(dbLite, 'leaderboard', profile.id));
      if (!lbSnap.exists()) {
        await syncNodeLeaderboardEntry(profile);
      }
    }
  } catch (err) {
    console.warn('Cloud seed notice:', err);
  }
}

export async function fetchNodeLeaderboard(maxEntries = 20): Promise<LeaderboardEntry[]> {
  try {
    const q = query(
      collection(dbLite, 'leaderboard'),
      orderBy('rewardPoints', 'desc'),
      limit(maxEntries)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        profileId: String(data.profileId || d.id),
        fullName: String(data.fullName || 'JIT Player'),
        avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '/assets/aistudio/image_e64e54f2.png',
        rewardPoints: Number(data.rewardPoints || 0),
        gamesPlayed: Number(data.gamesPlayed || 0),
        gamesWon: Number(data.gamesWon || 0),
        streakDays: Number(data.streakDays || 1),
        lastGameId: typeof data.lastGameId === 'string' ? data.lastGameId : undefined,
      };
    });
  } catch (err) {
    console.warn('Leaderboard fetch notice (node):', err);
    return [];
  }
}

export async function fetchNodeMatchHistory(profileId?: string, maxEntries = 20): Promise<MatchHistoryRecord[]> {
  try {
    const colRef = collection(dbLite, 'match_history');
    const q = profileId
      ? query(colRef, where('profileId', '==', profileId), orderBy('createdAtTs', 'desc'), limit(maxEntries))
      : query(colRef, orderBy('createdAtTs', 'desc'), limit(maxEntries));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: String(data.id || d.id),
        profileId: String(data.profileId || ''),
        playerName: String(data.playerName || 'JIT Player'),
        gameId: String(data.gameId || 'tictactoe') as GameId,
        gameName: String(data.gameName || 'Game'),
        mode: (data.mode || 'ai') as MatchHistoryRecord['mode'],
        outcome: (data.outcome || 'win') as MatchHistoryRecord['outcome'],
        pointsEarned: Number(data.pointsEarned || 0),
        scoreSummary: String(data.scoreSummary || ''),
        createdAt: String(data.createdAt || new Date().toISOString()),
      };
    });
  } catch {
    return [];
  }
}
