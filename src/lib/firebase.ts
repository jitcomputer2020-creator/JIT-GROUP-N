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
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { UserProfile } from '../types';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'profiles', newProfile.id), firestoreProfileDoc);
    batch.set(doc(db, 'phone_index', phoneKey), {
      profileId: newProfile.id,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
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
      if (updates.coverUrl !== undefined && updates.coverUrl.length <= 380000) {
        detailPatch.coverUrl = updates.coverUrl;
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
