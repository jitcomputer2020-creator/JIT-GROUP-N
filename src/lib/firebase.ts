/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Shared Firebase Firestore Cloud Persistence Layer
 * Provides cross-browser, cross-device, incognito-safe profile storage,
 * contact-number lookup, login timestamp refresh, and 180-day auto-cleanup.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
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
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile, LeaderboardEntry, MatchHistoryRecord, GameId } from '../types';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // 180 consecutive days (6 months)

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection on boot using getDocFromServer
export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export function normalizeDigitsOnly(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

/**
 * Canonical phone lookup key:
 * Uses last 10 digits for 10+ digit numbers so "+91 98744 92871", "09874492871",
 * "919874492871", and "9874492871" all resolve deterministically to the same account.
 */
export function toCanonicalPhoneKey(phone: string): string {
  const digits = normalizeDigitsOnly(phone);
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

function isCloudTimestampExpired(ts: unknown, fallbackIso?: string): boolean {
  if (ts && typeof (ts as Timestamp).toMillis === 'function') {
    const ms = (ts as Timestamp).toMillis();
    return Date.now() - ms > INACTIVITY_EXPIRY_MS;
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
  if (url.length > 395000) return '/assets/aistudio/image_e64e54f2.png';
  return url;
}

/**
 * Attempts to upload a compressed profile/cover Data URL to Firebase Storage
 * to obtain a short permanent CDN download URL. If Storage is unavailable or
 * restricted, gracefully falls back to the compressed Data URL for direct Firestore storage.
 */
export async function uploadProfilePhotoToCloud(
  profileId: string,
  mode: 'avatar' | 'cover',
  dataUrl: string
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  try {
    const ext = dataUrl.startsWith('data:image/webp')
      ? 'webp'
      : dataUrl.startsWith('data:image/png')
      ? 'png'
      : 'jpg';
    const fileRef = storageRef(storage, `profile_media/${profileId}/${mode}_${Date.now()}.${ext}`);

    const downloadUrl = await Promise.race<string>([
      (async () => {
        await uploadString(fileRef, dataUrl, 'data_url');
        return await getDownloadURL(fileRef);
      })(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Storage upload timeout')), 3500)
      ),
    ]);

    if (downloadUrl && downloadUrl.startsWith('http')) {
      return downloadUrl;
    }
  } catch (err) {
    console.info('Firebase Storage upload skipped, storing compressed photo directly in Firestore:', err);
  }

  return dataUrl;
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
    avatarUrl:
      typeof data.avatarUrl === 'string' && data.avatarUrl.length > 0
        ? data.avatarUrl
        : '/assets/aistudio/image_e64e54f2.png',
    coverUrl: typeof data.coverUrl === 'string' && data.coverUrl.length > 0 ? data.coverUrl : undefined,
    joinedAt: String(data.joinedAt || lastLoginIso),
    lastLoginAt: String(data.lastLoginAt || lastLoginIso),
    lastLogin: String(data.lastLogin || data.lastLoginAt || lastLoginIso),
    isContactNumberPublic: Boolean(data.isContactNumberPublic),
    isAddressPublic: Boolean(data.isAddressPublic),
    stats: sanitizeStats(data.stats),
  };
}

async function fetchDocServerFirst(pathSegments: [string, string]) {
  const ref = doc(db, pathSegments[0], pathSegments[1]);
  try {
    return await getDocFromServer(ref);
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.GET, `${pathSegments[0]}/${pathSegments[1]}`);
    }
    // Fallback to cache only if client is genuinely offline
    try {
      return await getDoc(ref);
    } catch (fallbackErr: any) {
      if (fallbackErr?.code === 'permission-denied') {
        handleFirestoreError(fallbackErr, OperationType.GET, `${pathSegments[0]}/${pathSegments[1]}`);
      }
      throw fallbackErr;
    }
  }
}

/**
 * Deletes an expired profile (>180 days inactive) from Firestore.
 * Firestore security rules independently verify request.time > lastActiveAt + 180d.
 */
async function cleanupExpiredCloudProfile(phoneKey: string, profileId: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'phone_index', phoneKey));
    batch.delete(doc(db, 'profiles', profileId));
    await batch.commit();
  } catch (err) {
    // Non-fatal if already deleted or rules reject
    console.warn('Expired profile cloud cleanup notice:', err);
  }
}

/**
 * Looks up a registered profile directly in Firestore by contact number.
 * Automatically purges accounts inactive for more than 180 days.
 */
export async function lookupCloudProfileByPhone(
  contactNumber: string
): Promise<{ found: boolean; profile?: UserProfile; expired?: boolean }> {
  const phoneKey = toCanonicalPhoneKey(contactNumber);
  if (!phoneKey || phoneKey.length < 7) {
    return { found: false };
  }

  const indexSnap = await fetchDocServerFirst(['phone_index', phoneKey]);
  if (!indexSnap.exists()) {
    return { found: false };
  }

  const indexData = indexSnap.data();
  const profileId = indexData?.profileId;
  if (!profileId || typeof profileId !== 'string') {
    return { found: false };
  }

  if (isCloudTimestampExpired(indexData.lastLoginAt)) {
    await cleanupExpiredCloudProfile(phoneKey, profileId);
    return { found: false, expired: true };
  }

  const profileSnap = await fetchDocServerFirst(['profiles', profileId]);
  if (!profileSnap.exists()) {
    return { found: false };
  }

  const profileData = profileSnap.data();
  if (
    profileId !== 'usr_jit_primary_001' &&
    isCloudTimestampExpired(profileData.lastActiveAt, profileData.lastLoginAt || profileData.lastLogin)
  ) {
    await cleanupExpiredCloudProfile(phoneKey, profileId);
    return { found: false, expired: true };
  }

  return {
    found: true,
    profile: firestoreDocToUserProfile(profileData),
  };
}

/**
 * Looks up a profile by phone in Firestore and refreshes its lastLogin timestamp.
 */
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

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'profiles', profile.id), {
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    });
    batch.update(doc(db, 'phone_index', phoneKey), {
      lastLoginAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `profiles/${profile.id}`);
    }
    throw err;
  }

  return {
    success: true,
    profile: {
      ...profile,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
    },
  };
}

/**
 * Creates a brand new profile in Firestore (atomic profile + phone_index batch),
 * OR recognizes an existing active profile without wiping its points/stats.
 */
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

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'profiles', prev.id), {
        fullName: cleanName,
        address: cleanAddr,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        lastActiveAt: serverTimestamp(),
      });
      batch.update(doc(db, 'phone_index', phoneKey), {
        lastLoginAt: serverTimestamp(),
      });
      await batch.commit();
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.UPDATE, `profiles/${prev.id}`);
      }
      throw err;
    }

    return {
      success: true,
      isExisting: true,
      profile: {
        ...prev,
        fullName: cleanName,
        address: cleanAddr,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
      },
    };
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
    ...(seedProfile?.coverUrl && seedProfile.coverUrl.length <= 395000
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

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'profiles', newProfile.id), firestoreProfileDoc);
    batch.set(doc(db, 'phone_index', phoneKey), {
      profileId: newProfile.id,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
    batch.set(doc(db, 'leaderboard', newProfile.id), {
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
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `profiles/${newProfile.id}`);
    }
    throw err;
  }

  return {
    success: true,
    isExisting: false,
    profile: newProfile,
  };
}

/**
 * Updates profile fields or stats in Firestore while keeping lastActiveAt refreshed.
 */
export async function updateCloudProfile(
  profile: UserProfile,
  updates: Partial<UserProfile>
): Promise<void> {
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  if (!phoneKey || phoneKey.length < 7) return;

  const nowIso = new Date().toISOString();
  const profileRef = doc(db, 'profiles', profile.id);
  const indexRef = doc(db, 'phone_index', phoneKey);

  // Ensure document exists first; if not, seed it atomically
  const existingSnap = await fetchDocServerFirst(['profiles', profile.id]);
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
    await touchCloudLoginTimestamp(profile);
    return;
  }

  try {
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
      if (updates.coverUrl !== undefined) {
        if (updates.coverUrl === '') {
          detailPatch.coverUrl = '';
        } else if (updates.coverUrl.length <= 395000) {
          detailPatch.coverUrl = updates.coverUrl;
        }
      }
      if (updates.isContactNumberPublic !== undefined) {
        detailPatch.isContactNumberPublic = Boolean(updates.isContactNumberPublic);
      }
      if (updates.isAddressPublic !== undefined) {
        detailPatch.isAddressPublic = Boolean(updates.isAddressPublic);
      }

      const batch = writeBatch(db);
      batch.update(profileRef, detailPatch);
      batch.update(indexRef, { lastLoginAt: serverTimestamp() });
      await batch.commit();
    }

    if (hasStatsUpdate) {
      const batch = writeBatch(db);
      batch.update(profileRef, {
        stats: sanitizeStats(updates.stats),
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        lastActiveAt: serverTimestamp(),
      });
      batch.update(indexRef, { lastLoginAt: serverTimestamp() });
      await batch.commit();
    }
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `profiles/${profile.id}`);
    }
    console.warn('Firestore updateCloudProfile notice:', err);
  }
}

/**
 * Ensures a profile exists in Firestore without overwriting fresher cloud state.
 */
export async function ensureCloudProfileSeeded(profile: UserProfile): Promise<void> {
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  if (!phoneKey || phoneKey.length < 7) return;
  try {
    const existing = await fetchDocServerFirst(['phone_index', phoneKey]);
    if (!existing.exists()) {
      await registerOrRecognizeCloudProfile(
        profile.contactNumber,
        profile.fullName,
        profile.address,
        profile
      );
    } else {
      const lbSnap = await fetchDocServerFirst(['leaderboard', profile.id]);
      if (!lbSnap.exists()) {
        await syncLeaderboardEntry(profile);
      }
    }
  } catch (err) {
    console.warn('Cloud seed notice:', err);
  }
}

/**
 * Standalone helper for touching login timestamp on a known profile.
 */
export async function touchCloudLoginTimestamp(profile: UserProfile): Promise<void> {
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  if (!phoneKey || phoneKey.length < 7) return;
  const nowIso = new Date().toISOString();
  try {
    await updateDoc(doc(db, 'profiles', profile.id), {
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'phone_index', phoneKey), {
      lastLoginAt: serverTimestamp(),
    });
  } catch {
    // Best-effort
  }
}

/**
 * Syncs non-PII public gaming stats to /leaderboard/{profileId}.
 */
export async function syncLeaderboardEntry(
  profile: UserProfile,
  lastGameId?: string
): Promise<void> {
  if (!profile?.id) return;
  const stats = sanitizeStats(profile.stats);
  const path = `leaderboard/${profile.id}`;
  try {
    await setDoc(doc(db, 'leaderboard', profile.id), {
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
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
    console.warn('Leaderboard sync notice:', err);
  }
}

/**
 * Queries top global players sorted by JIT rewardPoints descending.
 */
export async function fetchGlobalLeaderboard(maxEntries = 20): Promise<LeaderboardEntry[]> {
  try {
    const q = query(
      collection(db, 'leaderboard'),
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
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.LIST, 'leaderboard');
    }
    console.warn('Global leaderboard fetch notice:', err);
    return [];
  }
}

/**
 * Records an immutable match outcome or daily spin event to /match_history/{matchId}.
 */
export async function recordCloudMatchHistory(
  record: MatchHistoryRecord
): Promise<void> {
  const path = `match_history/${record.id}`;
  try {
    await setDoc(doc(db, 'match_history', record.id), {
      id: record.id,
      profileId: record.profileId,
      playerName: (record.playerName || 'JIT Member').trim().slice(0, 120),
      gameId: String(record.gameId).slice(0, 32),
      gameName: String(record.gameName).slice(0, 64),
      mode: record.mode,
      outcome: record.outcome,
      pointsEarned: Math.min(500, Math.max(0, Math.floor(Number(record.pointsEarned || 0)))),
      scoreSummary: String(record.scoreSummary || 'Match completed').slice(0, 180),
      createdAt: String(record.createdAt || new Date().toISOString()).slice(0, 40),
      createdAtTs: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
    console.warn('Match history write notice:', err);
  }
}

/**
 * Fetches recent match history entries (global or filtered to a profile).
 */
export async function fetchMatchHistory(
  profileId?: string,
  maxEntries = 20
): Promise<MatchHistoryRecord[]> {
  try {
    const colRef = collection(db, 'match_history');
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
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.LIST, 'match_history');
    }
    // Fallback without composite index if needed
    if (profileId) {
      try {
        const snap = await getDocs(
          query(collection(db, 'match_history'), orderBy('createdAtTs', 'desc'), limit(maxEntries * 2))
        );
        return snap.docs
          .map((d) => {
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
          })
          .filter((r) => r.profileId === profileId)
          .slice(0, maxEntries);
      } catch {
        return [];
      }
    }
    return [];
  }
}

