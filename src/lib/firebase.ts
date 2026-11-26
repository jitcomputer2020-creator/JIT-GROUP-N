/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Shared Firebase Firestore Cloud Persistence Layer
 * Provides cross-browser, cross-device, incognito-safe profile storage,
 * contact-number lookup, login timestamp refresh, and 180-day auto-cleanup.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  User as FirebaseAuthUser,
} from 'firebase/auth';
import {
  getStorage,
  ref as storageRef,
  uploadString,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  collection,
  collectionGroup,
  query,
  orderBy,
  limit,
  limitToLast,
  where,
  serverTimestamp,
  deleteField,
  arrayUnion,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { detectExpressBackendAvailable, safeFetchJson } from '../utils/safeFetch';
import {
  isPlaceholderOrInvalidMediaString,
  isValidImageUrl,
  isValidVideoUrl,
  sanitizeVideoUrl,
} from './mediaValidation';
import { normalizeTimestamp, resolveServerTimeLabel, sortMessagesChronologically } from './chatTimestamp';
import {
  UserProfile,
  LeaderboardEntry,
  MatchHistoryRecord,
  GameId,
  FriendRequest,
  InAppNotification,
  Conversation,
  Message,
  Reel,
  Post,
  GlobalAnnouncement,
} from '../types';
import {
  MultiplayerRoom,
  RoomParticipantInfo,
  RoomPlayer,
  RoomLastMove,
  InGameChatMessage,
  RoomReaction,
} from '../types/multiplayer';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const authPersistenceReady: Promise<void> =
  typeof window !== 'undefined'
    ? setPersistence(auth, browserLocalPersistence).catch((err) => {
        console.warn('Firebase browserLocalPersistence notice:', err);
      })
    : Promise.resolve();

export function subscribeToFirebaseAuthState(
  callback: (user: FirebaseAuthUser | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export async function signOutFirebaseAuth(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // Non-fatal offline sign-out fallback
  }
}

export const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // 180 consecutive days (6 months)
export const VIDEO_EXPIRY_MS = 40 * 24 * 60 * 60 * 1000; // 40 days auto-delete for videos & reels
export const DAILY_CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms (24 hours)
export const DAILY_STREAK_GRACE_MS = 48 * 60 * 60 * 1000; // 172,800,000 ms (48 hours consecutive window)

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

function sanitizeRoomAvatarUrl(url?: string): string {
  if (!url) return '/assets/aistudio/image_e64e54f2.png';
  // Keep per-player avatar compact so gameRooms playersJson stays well below Firestore's 100KB cap
  if (url.length > 18000) return '/assets/aistudio/image_e64e54f2.png';
  return url;
}

export function deriveUsername(
  fullName: string,
  contactNumber?: string,
  explicitUsername?: string
): string {
  const cleanedExplicit = (explicitUsername || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleanedExplicit.length >= 2) {
    return cleanedExplicit.slice(0, 48);
  }
  const slug = (fullName || 'jit_member')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const digits = normalizeDigitsOnly(contactNumber || '');
  const suffix = digits.length >= 4 ? `_${digits.slice(-2)}` : '';
  const base = slug.length >= 2 ? slug : 'jit_member';
  return `${base}${suffix}`.slice(0, 48);
}

function buildUserDirectoryPayload(profile: UserProfile): Record<string, any> {
  const cleanName = (profile.fullName || 'JIT Member').trim().slice(0, 120) || 'JIT Member';
  const username = deriveUsername(cleanName, profile.contactNumber, profile.username);
  const digits = normalizeDigitsOnly(profile.contactNumber || '');
  const stats = sanitizeStats(profile.stats);
  return {
    profileId: profile.id,
    fullName: cleanName,
    fullNameLower: cleanName.toLowerCase(),
    username,
    usernameLower: username.toLowerCase(),
    avatarUrl: sanitizeAvatarUrl(profile.avatarUrl),
    bio: (profile.bio || '').slice(0, 500),
    address: (profile.address || 'JIT Campus').slice(0, 300),
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : '',
    rewardPoints: stats.rewardPoints,
    gamesWon: stats.gamesWon,
    updatedAt: serverTimestamp(),
  };
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

  const fullName = String(data.fullName || 'JIT Member');
  const contactNumber = String(data.contactNumber || '');
  const lastDailyClaimAt =
    typeof data.lastDailyClaimAt === 'number' &&
    Number.isFinite(data.lastDailyClaimAt) &&
    data.lastDailyClaimAt > 0
      ? data.lastDailyClaimAt
      : undefined;

  return {
    id: String(data.id),
    contactNumber,
    fullName,
    username: deriveUsername(fullName, contactNumber, typeof data.username === 'string' ? data.username : undefined),
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
    status: (data.status as UserProfile['status']) || 'active',
    suspendedReason: typeof data.suspendedReason === 'string' && data.suspendedReason ? data.suspendedReason : undefined,
    suspendedAt: typeof data.suspendedAt === 'string' && data.suspendedAt ? data.suspendedAt : undefined,
    ...(lastDailyClaimAt ? { lastDailyClaimAt } : {}),
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
  if (profileData.status === 'deleted') {
    return { found: false };
  }
  if (
    profileId !== 'usr_jit_primary_001' &&
    isCloudTimestampExpired(profileData.lastActiveAt, profileData.lastLoginAt || profileData.lastLogin)
  ) {
    await cleanupExpiredCloudProfile(phoneKey, profileId);
    return { found: false, expired: true };
  }

  const profile = firestoreDocToUserProfile(profileData);
  try {
    const userSnap = await fetchDocServerFirst(['users', profileId]);
    if (userSnap.exists()) {
      const userClaimAt = Number(userSnap.data()?.lastDailyClaimAt || 0);
      if (Number.isFinite(userClaimAt) && userClaimAt > (profile.lastDailyClaimAt || 0)) {
        profile.lastDailyClaimAt = userClaimAt;
      }
    }
  } catch {
    // Non-fatal if users alias doc does not exist yet
  }

  return {
    found: true,
    profile,
  };
}

/**
 * Looks up a profile by phone in Firestore and refreshes its lastLogin timestamp.
 */
export async function loginCloudProfileByPhone(
  contactNumber: string
): Promise<{ success: boolean; profile?: UserProfile; expired?: boolean; suspended?: boolean; suspendedReason?: string }> {
  const lookup = await lookupCloudProfileByPhone(contactNumber);
  if (!lookup.found || !lookup.profile) {
    return { success: false, expired: lookup.expired };
  }

  const profile = lookup.profile;
  if (profile.status === 'suspended') {
    return {
      success: false,
      suspended: true,
      suspendedReason: profile.suspendedReason || 'Suspended by administrator.',
    };
  }
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
    batch.set(doc(db, 'user_directory', profile.id), buildUserDirectoryPayload(profile));
    await batch.commit();
    invalidateDirectoryCache();
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

    const mergedExisting: UserProfile = {
      ...prev,
      fullName: cleanName,
      address: cleanAddr,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
    };

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
      batch.set(doc(db, 'user_directory', prev.id), buildUserDirectoryPayload(mergedExisting));
      await batch.commit();
      invalidateDirectoryCache();
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.UPDATE, `profiles/${prev.id}`);
      }
      throw err;
    }

    return {
      success: true,
      isExisting: true,
      profile: mergedExisting,
    };
  }

  const profileId =
    seedProfile?.id || `usr_jit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const cleanFullName = (seedProfile?.fullName || fullName).trim().slice(0, 120);
  const cleanContact = (seedProfile?.contactNumber || contactNumber).trim().slice(0, 30);
  const derivedUsername = deriveUsername(cleanFullName, cleanContact, seedProfile?.username);

  const newProfile: UserProfile = {
    id: profileId,
    contactNumber: cleanContact,
    fullName: cleanFullName,
    username: derivedUsername,
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
    ...(seedProfile?.lastDailyClaimAt && seedProfile.lastDailyClaimAt > 0
      ? { lastDailyClaimAt: seedProfile.lastDailyClaimAt }
      : {}),
    stats: sanitizeStats(seedProfile?.stats || { rewardPoints: 100, streakDays: 1 }),
  };

  const firestoreProfileDoc: Record<string, any> = {
    id: newProfile.id,
    contactNumber: newProfile.contactNumber,
    phoneKey,
    fullName: newProfile.fullName,
    username: derivedUsername,
    address: newProfile.address,
    bio: newProfile.bio || '',
    avatarUrl: newProfile.avatarUrl,
    joinedAt: newProfile.joinedAt,
    lastLoginAt: newProfile.lastLoginAt,
    lastLogin: newProfile.lastLogin,
    lastActiveAt: serverTimestamp(),
    isContactNumberPublic: Boolean(newProfile.isContactNumberPublic),
    isAddressPublic: Boolean(newProfile.isAddressPublic),
    ...(newProfile.lastDailyClaimAt ? { lastDailyClaimAt: newProfile.lastDailyClaimAt } : {}),
    stats: newProfile.stats,
  };
  if (newProfile.coverUrl) {
    firestoreProfileDoc.coverUrl = newProfile.coverUrl;
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'profiles', newProfile.id), firestoreProfileDoc);
    batch.set(doc(db, 'users', newProfile.id), firestoreProfileDoc, { merge: true });
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
    batch.set(doc(db, 'user_directory', newProfile.id), buildUserDirectoryPayload(newProfile));
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
    'username',
    'bio',
    'address',
    'avatarUrl',
    'coverUrl',
    'isContactNumberPublic',
    'isAddressPublic',
  ] as const;
  const hasDetailUpdates = detailKeys.some((k) => updates[k] !== undefined);
  const hasStatsUpdate = updates.stats !== undefined;
  const hasClaimUpdate =
    typeof updates.lastDailyClaimAt === 'number' && Number.isFinite(updates.lastDailyClaimAt);

  if (!hasDetailUpdates && !hasStatsUpdate && !hasClaimUpdate) {
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
      if (updates.username !== undefined) {
        detailPatch.username = deriveUsername(
          updates.fullName || profile.fullName,
          profile.contactNumber,
          updates.username
        );
      }
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

      const mergedProfile: UserProfile = {
        ...profile,
        ...updates,
        ...(detailPatch.username ? { username: detailPatch.username } : {}),
        stats: sanitizeStats(updates.stats || profile.stats),
      };
      const batch = writeBatch(db);
      batch.update(profileRef, detailPatch);
      batch.set(doc(db, 'users', profile.id), { id: profile.id, ...detailPatch }, { merge: true });
      batch.update(indexRef, { lastLoginAt: serverTimestamp() });
      batch.set(doc(db, 'user_directory', profile.id), buildUserDirectoryPayload(mergedProfile));
      await batch.commit();
      invalidateDirectoryCache();
    }

    if (hasStatsUpdate || hasClaimUpdate) {
      const mergedStats = sanitizeStats(updates.stats || profile.stats);
      const mergedProfile: UserProfile = {
        ...profile,
        ...updates,
        stats: mergedStats,
      };
      const statsPatch: Record<string, any> = {
        stats: mergedStats,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        lastActiveAt: serverTimestamp(),
      };
      if (hasClaimUpdate) {
        statsPatch.lastDailyClaimAt = updates.lastDailyClaimAt;
      }
      const batch = writeBatch(db);
      batch.update(profileRef, statsPatch);
      batch.set(doc(db, 'users', profile.id), { id: profile.id, ...statsPatch }, { merge: true });
      batch.update(indexRef, { lastLoginAt: serverTimestamp() });
      batch.set(doc(db, 'user_directory', profile.id), buildUserDirectoryPayload(mergedProfile));
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
 * Atomically enforces the strict 24-hour cooldown for Daily +50 Pts rewards
 * inside Firestore (`users/{userId}` and `profiles/{userId}`) via transaction.
 */
export async function claimCloudDailyReward(
  profile: UserProfile,
  pointsToAdd = 50
): Promise<{
  allowed: boolean;
  lastDailyClaimAt: number;
  rewardPoints: number;
  streakDays: number;
  offlineFallback?: boolean;
}> {
  const userRef = doc(db, 'users', profile.id);
  const profileRef = doc(db, 'profiles', profile.id);
  const lbRef = doc(db, 'leaderboard', profile.id);
  const dirRef = doc(db, 'user_directory', profile.id);
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  const indexRef = phoneKey && phoneKey.length >= 7 ? doc(db, 'phone_index', phoneKey) : null;

  try {
    const result = await runTransaction(db, async (tx) => {
      const [userSnap, profileSnap] = await Promise.all([tx.get(userRef), tx.get(profileRef)]);
      const userData = userSnap.exists() ? userSnap.data() : {};
      const profileData = profileSnap.exists() ? profileSnap.data() : {};

      const serverLastClaimAt = Math.max(
        Number(userData?.lastDailyClaimAt || 0),
        Number(profileData?.lastDailyClaimAt || 0)
      );
      const localLastClaimAt = Number(profile.lastDailyClaimAt || 0);
      const authoritativeLastClaim = Math.max(serverLastClaimAt, localLastClaimAt);

      const nowMs = Date.now();
      if (authoritativeLastClaim > 0 && nowMs - authoritativeLastClaim < DAILY_CLAIM_COOLDOWN_MS) {
        const currentStats = sanitizeStats(profileData?.stats || userData?.stats || profile.stats);
        return {
          allowed: false,
          lastDailyClaimAt: authoritativeLastClaim,
          rewardPoints: currentStats.rewardPoints,
          streakDays: currentStats.streakDays,
        };
      }

      const baseStats = sanitizeStats(profileData?.stats || userData?.stats || profile.stats);
      const elapsedSinceLast = authoritativeLastClaim > 0 ? nowMs - authoritativeLastClaim : 0;
      const nextStreak =
        authoritativeLastClaim > 0 && elapsedSinceLast <= DAILY_STREAK_GRACE_MS
          ? Math.max(1, baseStats.streakDays) + 1
          : 1;
      const nextPoints = Math.min(1000000, baseStats.rewardPoints + pointsToAdd);
      const nextStats: UserProfile['stats'] = {
        ...baseStats,
        rewardPoints: nextPoints,
        streakDays: nextStreak,
      };
      const nowIso = new Date(nowMs).toISOString();

      const updatedProfile: UserProfile = {
        ...profile,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        lastDailyClaimAt: nowMs,
        stats: nextStats,
      };

      const commonPatch: Record<string, any> = {
        id: profile.id,
        fullName: updatedProfile.fullName,
        contactNumber: updatedProfile.contactNumber,
        ...(phoneKey ? { phoneKey } : {}),
        address: updatedProfile.address,
        avatarUrl: sanitizeAvatarUrl(updatedProfile.avatarUrl),
        joinedAt: updatedProfile.joinedAt || nowIso,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        lastActiveAt: serverTimestamp(),
        lastDailyClaimAt: nowMs,
        stats: nextStats,
      };

      tx.set(userRef, commonPatch, { merge: true });
      tx.set(profileRef, commonPatch, { merge: true });
      tx.set(
        lbRef,
        {
          profileId: profile.id,
          fullName: (updatedProfile.fullName || 'JIT Member').trim().slice(0, 120),
          avatarUrl: sanitizeAvatarUrl(updatedProfile.avatarUrl),
          rewardPoints: nextStats.rewardPoints,
          gamesPlayed: nextStats.gamesPlayed,
          gamesWon: nextStats.gamesWon,
          streakDays: nextStats.streakDays,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(dirRef, buildUserDirectoryPayload(updatedProfile), { merge: true });
      if (indexRef) {
        tx.set(
          indexRef,
          {
            profileId: profile.id,
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      return {
        allowed: true,
        lastDailyClaimAt: nowMs,
        rewardPoints: nextStats.rewardPoints,
        streakDays: nextStats.streakDays,
      };
    });

    return result;
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `users/${profile.id}`);
    }
    console.warn('claimCloudDailyReward offline fallback:', err);
    const nowMs = Date.now();
    const prevClaimAt = Number(profile.lastDailyClaimAt || 0);
    if (prevClaimAt > 0 && nowMs - prevClaimAt < DAILY_CLAIM_COOLDOWN_MS) {
      return {
        allowed: false,
        lastDailyClaimAt: prevClaimAt,
        rewardPoints: profile.stats.rewardPoints,
        streakDays: profile.stats.streakDays,
        offlineFallback: true,
      };
    }
    const elapsed = prevClaimAt > 0 ? nowMs - prevClaimAt : 0;
    const nextStreak =
      prevClaimAt > 0 && elapsed <= DAILY_STREAK_GRACE_MS
        ? Math.max(1, profile.stats.streakDays) + 1
        : 1;
    return {
      allowed: true,
      lastDailyClaimAt: nowMs,
      rewardPoints: Math.min(1000000, (profile.stats.rewardPoints || 0) + pointsToAdd),
      streakDays: nextStreak,
      offlineFallback: true,
    };
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
      const [lbSnap, dirSnap] = await Promise.all([
        fetchDocServerFirst(['leaderboard', profile.id]),
        fetchDocServerFirst(['user_directory', profile.id]),
      ]);
      if (!lbSnap.exists()) {
        await syncLeaderboardEntry(profile);
      }
      if (!dirSnap.exists()) {
        await setDoc(doc(db, 'user_directory', profile.id), buildUserDirectoryPayload(profile));
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
      where('rewardPoints', '>=', 0),
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
      ? query(
          colRef,
          where('profileId', '==', profileId),
          where('pointsEarned', '>=', 0),
          orderBy('createdAtTs', 'desc'),
          limit(maxEntries)
        )
      : query(
          colRef,
          where('pointsEarned', '>=', 0),
          orderBy('createdAtTs', 'desc'),
          limit(maxEntries)
        );
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
          query(
            collection(db, 'match_history'),
            where('pointsEarned', '>=', 0),
            orderBy('createdAtTs', 'desc'),
            limit(maxEntries * 2)
          )
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

/**
 * Signs in the verified Administrator via Google Auth (for direct Firestore /profiles list rule).
 */
export async function signInAdminWithGoogle(): Promise<{
  email: string | null;
  uid: string;
}> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return {
    email: cred.user.email,
    uid: cred.user.uid,
  };
}

export async function signOutAdminGoogle(): Promise<void> {
  await signOut(auth);
}

/**
 * Directly lists /profiles from Firestore when signed in as verified Google Admin.
 */
export async function fetchAllCloudProfilesAsAdmin(): Promise<UserProfile[]> {
  if (!auth.currentUser) {
    return [];
  }
  try {
    const snap = await getDocs(collection(db, 'profiles'));
    return snap.docs
      .map((d) => firestoreDocToUserProfile(d.data()))
      .filter((p) => p.status !== 'deleted');
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.LIST, 'profiles');
    }
    throw err;
  }
}

/**
 * Hard-deletes a user profile, phone_index, and leaderboard entry when signed in as Google Admin.
 */
export async function deleteCloudProfileAsAdmin(profile: UserProfile): Promise<void> {
  if (!auth.currentUser || !profile?.id) return;
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'profiles', profile.id));
    if (phoneKey && phoneKey.length >= 7) {
      batch.delete(doc(db, 'phone_index', phoneKey));
    }
    batch.delete(doc(db, 'leaderboard', profile.id));
    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.DELETE, `profiles/${profile.id}`);
    }
    throw err;
  }
}

// ============================================================================
// APP-WIDE USER DIRECTORY & SEARCH
// ============================================================================

function directoryDocToUserProfile(data: Record<string, any>): UserProfile {
  const fullName = String(data.fullName || 'JIT Member');
  const phoneLast4 = typeof data.phoneLast4 === 'string' && data.phoneLast4 ? data.phoneLast4 : '';
  return {
    id: String(data.profileId || ''),
    contactNumber: phoneLast4 ? `******${phoneLast4}` : 'Private',
    fullName,
    username: deriveUsername(fullName, undefined, typeof data.username === 'string' ? data.username : undefined),
    address: String(data.address || 'JIT Campus'),
    bio: typeof data.bio === 'string' ? data.bio : '',
    avatarUrl: sanitizeAvatarUrl(typeof data.avatarUrl === 'string' ? data.avatarUrl : undefined),
    joinedAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    isContactNumberPublic: false,
    isAddressPublic: true,
    stats: sanitizeStats({
      rewardPoints: Number(data.rewardPoints ?? 100),
      gamesWon: Number(data.gamesWon ?? 0),
    }),
  };
}

export async function getCloudProfileById(profileId: string): Promise<UserProfile | null> {
  if (!profileId || profileId.length < 8) return null;
  try {
    const snap = await fetchDocServerFirst(['profiles', profileId]);
    if (snap.exists()) {
      const profile = firestoreDocToUserProfile(snap.data());
      if (profile.status !== 'deleted') return profile;
    }
  } catch {
    // fallback to directory
  }
  try {
    const dirSnap = await fetchDocServerFirst(['user_directory', profileId]);
    if (dirSnap.exists()) {
      return directoryDocToUserProfile(dirSnap.data());
    }
  } catch {
    // ignore
  }
  return null;
}

export function subscribeToCloudProfile(
  profileId: string,
  onProfile: (profile: UserProfile | null, exists: boolean) => void
): Unsubscribe {
  if (!profileId || profileId.length < 4) {
    return () => {};
  }
  const profileRef = doc(db, 'profiles', profileId);
  const userRef = doc(db, 'users', profileId);
  let latestProfile: UserProfile | null = null;
  let latestUserClaimAt = 0;

  const emitMerged = (exists: boolean) => {
    if (!exists || !latestProfile) {
      onProfile(null, false);
      return;
    }
    const mergedClaimAt = Math.max(latestProfile.lastDailyClaimAt || 0, latestUserClaimAt);
    onProfile(
      mergedClaimAt > 0
        ? { ...latestProfile, lastDailyClaimAt: mergedClaimAt }
        : latestProfile,
      true
    );
  };

  const unsubProfile = onSnapshot(
    profileRef,
    (snap) => {
      if (!snap.exists()) {
        latestProfile = null;
        emitMerged(false);
        return;
      }
      latestProfile = firestoreDocToUserProfile(snap.data());
      emitMerged(true);
    },
    (err) => {
      console.warn('subscribeToCloudProfile notice:', err);
    }
  );

  const unsubUser = onSnapshot(
    userRef,
    (snap) => {
      if (!snap.exists()) return;
      const claimAt = Number(snap.data()?.lastDailyClaimAt || 0);
      if (Number.isFinite(claimAt) && claimAt > 0) {
        latestUserClaimAt = Math.max(latestUserClaimAt, claimAt);
        if (latestProfile) {
          emitMerged(true);
        }
      }
    },
    () => {}
  );

  return () => {
    unsubProfile();
    unsubUser();
  };
}

// In-memory directory cache (25s TTL) + private digit search map for instant partial matching
let cachedDirectoryList: UserProfile[] = [];
let cachedDirectoryAt = 0;
const searchablePhoneDigitsById = new Map<string, string>();

function invalidateDirectoryCache() {
  cachedDirectoryAt = 0;
}

export async function fetchPublicDirectory(maxEntries = 200, forceRefresh = false): Promise<UserProfile[]> {
  if (!forceRefresh && cachedDirectoryList.length > 0 && Date.now() - cachedDirectoryAt < 25000) {
    return cachedDirectoryList.slice(0, maxEntries);
  }

  const byId = new Map<string, UserProfile>();

  // 1. Fetch user_directory, users, and leaderboard in parallel so ALL registered Firebase users are discovered
  const [dirRes, usersRes, lbRes] = await Promise.allSettled([
    getDocs(
      query(
        collection(db, 'user_directory'),
        where('rewardPoints', '>=', 0),
        limit(Math.max(maxEntries, 200))
      )
    ),
    getDocs(
      query(
        collection(db, 'users'),
        limit(Math.max(maxEntries, 200))
      )
    ),
    getDocs(
      query(
        collection(db, 'leaderboard'),
        where('rewardPoints', '>=', 0),
        limit(Math.max(maxEntries, 200))
      )
    ),
  ]);

  if (dirRes.status === 'fulfilled') {
    dirRes.value.docs.forEach((d) => {
      const data = d.data();
      const profile = directoryDocToUserProfile({ profileId: d.id, ...data });
      if (profile.id) {
        byId.set(profile.id, profile);
        const last4 = typeof data.phoneLast4 === 'string' ? data.phoneLast4 : '';
        if (last4) searchablePhoneDigitsById.set(profile.id, last4);
      }
    });
  } else if ((dirRes.reason as any)?.code === 'permission-denied') {
    handleFirestoreError(dirRes.reason, OperationType.LIST, 'user_directory');
  }

  if (usersRes.status === 'fulfilled') {
    usersRes.value.docs.forEach((d) => {
      const uData = d.data();
      if (!uData || uData.status === 'deleted') return;
      const fullProfile = firestoreDocToUserProfile({ id: d.id, ...uData });
      if (!fullProfile.id) return;
      const pDigits = normalizeDigitsOnly(fullProfile.contactNumber || '');
      if (pDigits) searchablePhoneDigitsById.set(fullProfile.id, pDigits);
      byId.set(fullProfile.id, {
        ...fullProfile,
        contactNumber: fullProfile.isContactNumberPublic
          ? fullProfile.contactNumber
          : pDigits.length >= 4
          ? `******${pDigits.slice(-4)}`
          : 'Private',
      });
    });
  }

  const missingProfileIds: Array<{ id: string; lbData: Record<string, any> }> = [];
  if (lbRes.status === 'fulfilled') {
    lbRes.value.docs.forEach((d) => {
      const data = d.data();
      const pid = String(data.profileId || d.id);
      if (pid && !byId.has(pid)) {
        missingProfileIds.push({ id: pid, lbData: data });
      }
    });
  }

  // 2. Hydrate any registered users present in leaderboard but missing from user_directory
  if (missingProfileIds.length > 0) {
    const CHUNK = 12;
    for (let i = 0; i < missingProfileIds.length; i += CHUNK) {
      const slice = missingProfileIds.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async ({ id, lbData }) => {
          try {
            const pSnap = await getDoc(doc(db, 'profiles', id));
            if (pSnap.exists()) {
              const pData = pSnap.data();
              if (pData.status === 'deleted') return;
              const fullProfile = firestoreDocToUserProfile(pData);
              const pDigits = normalizeDigitsOnly(fullProfile.contactNumber || '');
              if (pDigits) searchablePhoneDigitsById.set(fullProfile.id, pDigits);
              byId.set(fullProfile.id, {
                ...fullProfile,
                contactNumber: fullProfile.isContactNumberPublic
                  ? fullProfile.contactNumber
                  : pDigits.length >= 4
                  ? `******${pDigits.slice(-4)}`
                  : 'Private',
              });
              // Best-effort backfill of user_directory for future fast queries
              setDoc(doc(db, 'user_directory', fullProfile.id), buildUserDirectoryPayload(fullProfile)).catch(
                () => {}
              );
              return;
            }
          } catch {
            // Fall back to public leaderboard summary fields
          }
          const lbName = String(lbData.fullName || 'JIT Member');
          byId.set(id, {
            id,
            contactNumber: 'Private',
            fullName: lbName,
            username: deriveUsername(lbName),
            address: 'JIT Campus',
            bio: 'JIT Campus Member',
            avatarUrl: sanitizeAvatarUrl(typeof lbData.avatarUrl === 'string' ? lbData.avatarUrl : undefined),
            joinedAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            isContactNumberPublic: false,
            isAddressPublic: true,
            stats: sanitizeStats({
              rewardPoints: Number(lbData.rewardPoints ?? 100),
              gamesPlayed: Number(lbData.gamesPlayed ?? 0),
              gamesWon: Number(lbData.gamesWon ?? 0),
              streakDays: Number(lbData.streakDays ?? 1),
            }),
          });
        })
      );
    }
  }

  const list = Array.from(byId.values());
  if (list.length > 0) {
    cachedDirectoryList = list;
    cachedDirectoryAt = Date.now();
  }
  return list.slice(0, maxEntries);
}

/**
 * Case-insensitive partial-string search across ALL registered Firebase users matching:
 * displayName (fullName), username (@handle), or phone number.
 */
export async function searchCloudUsers(queryStr: string, maxResults = 30): Promise<UserProfile[]> {
  const raw = (queryStr || '').trim();
  const qLower = raw.toLowerCase().replace(/^@+/, '');
  const digits = normalizeDigitsOnly(raw);

  const byId = new Map<string, UserProfile>();

  // 1. Exact phone lookup if 7+ digits entered (finds any Firebase user even if not yet cached)
  if (digits.length >= 7) {
    try {
      const phoneRes = await lookupCloudProfileByPhone(raw);
      if (phoneRes.found && phoneRes.profile) {
        const pDigits = normalizeDigitsOnly(phoneRes.profile.contactNumber || '');
        if (pDigits) searchablePhoneDigitsById.set(phoneRes.profile.id, pDigits);
        byId.set(phoneRes.profile.id, {
          ...phoneRes.profile,
          contactNumber: phoneRes.profile.isContactNumberPublic
            ? phoneRes.profile.contactNumber
            : pDigits.length >= 4
            ? `******${pDigits.slice(-4)}`
            : 'Private',
        });
      }
    } catch {
      // non-fatal
    }
  }

  // 2. Query Firestore unified directory (user_directory + leaderboard + profiles hydration)
  try {
    const dirUsers = await fetchPublicDirectory(250);
    for (const u of dirUsers) {
      if (!qLower && digits.length === 0) {
        byId.set(u.id, u);
        continue;
      }
      const nameMatch = Boolean(qLower) && u.fullName.toLowerCase().includes(qLower);
      const uname = (u.username || deriveUsername(u.fullName)).toLowerCase();
      const userMatch = Boolean(qLower) && uname.includes(qLower);
      const bioMatch = Boolean(qLower) && (u.bio || '').toLowerCase().includes(qLower);
      const addrMatch = Boolean(qLower) && (u.address || '').toLowerCase().includes(qLower);
      const knownDigits =
        searchablePhoneDigitsById.get(u.id) || normalizeDigitsOnly(u.contactNumber || '');
      const phoneMatch =
        digits.length >= 3 &&
        (knownDigits.includes(digits) ||
          (digits.length >= 4 && knownDigits.includes(digits.slice(-4))));

      if (nameMatch || userMatch || bioMatch || addrMatch || phoneMatch) {
        if (!byId.has(u.id)) {
          byId.set(u.id, u);
        }
      }
    }
  } catch {
    // fallback continues
  }

  // 3. Also query backend /api/users/search when available (captures any local/Express profiles & full phone substrings)
  if (typeof fetch === 'function' && (await detectExpressBackendAvailable())) {
    const res = await safeFetchJson<{ users?: UserProfile[] }>(
      `/api/users/search?q=${encodeURIComponent(raw)}`
    );
    if (res.ok && res.data && Array.isArray(res.data.users)) {
      for (const u of res.data.users) {
        if (u?.id && !byId.has(u.id)) {
          byId.set(u.id, u);
        }
      }
    }
  }

  return Array.from(byId.values()).slice(0, maxResults);
}

// ============================================================================
// REAL-TIME 4-DIGIT MULTIPLAYER GAME ROOMS (FIRESTORE + ONSNAPSHOT)
// ============================================================================

function toFirestoreSafeValue(val: any, insideArray = false): any {
  if (val === undefined) return null;
  if (val === null || typeof val === 'string' || typeof val === 'boolean') return val;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (Array.isArray(val)) {
    // Firestore forbids direct nested arrays (e.g. Ludo tokens number[][], Chess board string[][])
    if (insideArray) {
      return { __row: val.map((item) => toFirestoreSafeValue(item, true)) };
    }
    return val.map((item) => toFirestoreSafeValue(item, true));
  }
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined && typeof v !== 'function') {
        out[k] = toFirestoreSafeValue(v, false);
      }
    }
    return out;
  }
  return String(val);
}

function fromFirestoreSafeValue(val: any): any {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map((item) => fromFirestoreSafeValue(item));
  }
  if (Array.isArray((val as any).__row)) {
    return (val as any).__row.map((item: any) => fromFirestoreSafeValue(item));
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = fromFirestoreSafeValue(v);
  }
  return out;
}

export function normalizeRoomId(raw: string | undefined | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed.length < 4 || trimmed.length > 160) return '';
  return /^[a-zA-Z0-9_\-.@:]+$/.test(trimmed) ? trimmed : '';
}

export function buildUnifiedBoardAndMoveFields(
  stateObj: Record<string, any> | null | undefined,
  moveAction: string,
  byPlayerId: string,
  explicitDiceRoll?: number | null,
  summary?: string
) {
  const safeObj = stateObj && typeof stateObj === 'object' ? stateObj : {};
  const firestoreMap = toFirestoreSafeValue(safeObj, false);
  const extractedDice =
    explicitDiceRoll !== undefined
      ? explicitDiceRoll
      : typeof safeObj.dice === 'number'
      ? safeObj.dice
      : typeof safeObj.diceRoll === 'number'
      ? safeObj.diceRoll
      : null;

  const lastMove: RoomLastMove = {
    action: String(moveAction || 'STATE_SYNC').slice(0, 40),
    byPlayerId: String(byPlayerId || safeObj.byPlayerId || '').slice(0, 64),
    byAuthUid: auth.currentUser?.uid || null,
    moveSeq: Number(safeObj.moveSeq || 0),
    moveId: typeof safeObj.moveId === 'string' ? safeObj.moveId : '',
    ...(summary ? { summary: summary.slice(0, 180) } : {}),
    timestampMs: Date.now(),
  };

  return {
    boardState: firestoreMap,
    gameState: firestoreMap,
    diceRoll: extractedDice,
    lastMove,
  };
}

function parseRoomSnapshotData(data: Record<string, any>): MultiplayerRoom {
  let players: RoomPlayer[] = [];
  let waitingPlayers: RoomPlayer[] = [];
  let reactions: RoomReaction[] = [];
  let mutedVoiceIds: string[] = [];
  let mutedChatIds: string[] = [];
  let gameState: any = null;
  let messages: InGameChatMessage[] = [];
  try {
    players = typeof data.playersJson === 'string' ? JSON.parse(data.playersJson) : [];
  } catch {
    players = [];
  }
  try {
    waitingPlayers = typeof data.waitingPlayersJson === 'string' ? JSON.parse(data.waitingPlayersJson) : [];
  } catch {
    waitingPlayers = [];
  }
  try {
    reactions = typeof data.reactionsJson === 'string' ? JSON.parse(data.reactionsJson) : [];
  } catch {
    reactions = [];
  }
  try {
    mutedVoiceIds = typeof data.mutedVoiceIdsJson === 'string' ? JSON.parse(data.mutedVoiceIdsJson) : [];
  } catch {
    mutedVoiceIds = [];
  }
  try {
    mutedChatIds = typeof data.mutedChatIdsJson === 'string' ? JSON.parse(data.mutedChatIdsJson) : [];
  } catch {
    mutedChatIds = [];
  }
  let parsedBoardField: any = null;
  if (Array.isArray(data.boardState)) {
    parsedBoardField = fromFirestoreSafeValue(data.boardState);
    gameState = {
      board: parsedBoardField,
      ...(data.scores && typeof data.scores === 'object' ? { scores: data.scores } : {}),
    };
  } else if (
    data.boardState &&
    typeof data.boardState === 'object' &&
    Object.keys(data.boardState).length > 0
  ) {
    gameState = fromFirestoreSafeValue(data.boardState);
    parsedBoardField = gameState;
  } else {
    try {
      const parsedJson =
        typeof data.gameStateJson === 'string' ? JSON.parse(data.gameStateJson) : null;
      if (parsedJson && Object.keys(parsedJson).length > 0) {
        gameState = parsedJson;
      } else if (
        data.gameState &&
        typeof data.gameState === 'object' &&
        Object.keys(data.gameState).length > 0
      ) {
        gameState = fromFirestoreSafeValue(data.gameState);
      } else {
        gameState = null;
      }
    } catch {
      gameState = null;
    }
    parsedBoardField = gameState;
  }
  try {
    messages = typeof data.messagesJson === 'string' ? JSON.parse(data.messagesJson) : [];
  } catch {
    messages = [];
  }

  const createdMs =
    data.createdAt && typeof data.createdAt.toMillis === 'function'
      ? data.createdAt.toMillis()
      : Date.now();
  const lastUpdatedMs =
    data.lastUpdated && typeof data.lastUpdated.toMillis === 'function'
      ? data.lastUpdated.toMillis()
      : data.updatedAt && typeof data.updatedAt.toMillis === 'function'
      ? data.updatedAt.toMillis()
      : createdMs;

  const isOpenGroup = Boolean(data.isOpenGroup);
  const maxPlayers = Number(data.maxPlayers || 2);
  const activeSeatLimit = Number(data.activeSeatLimit || maxPlayers || 2);

  const resolvedRoomId = String(data.roomId || data.roomCode || '');
  const resolvedGameType = String(data.gameType || data.gameId || 'tictactoe');
  const resolvedPlayer1Id = String(data.player1Id || data.player1 || data.hostId || players[0]?.id || '');
  const resolvedPlayer1Name = String(data.player1Name || players[0]?.name || '');
  const resolvedPlayer1AuthUid =
    typeof data.player1AuthUid === 'string' && data.player1AuthUid
      ? data.player1AuthUid
      : players[0]?.authUid || null;
  const resolvedPlayer2Id = String(data.player2Id || data.player2 || players[1]?.id || '');
  const resolvedPlayer2Name = String(data.player2Name || players[1]?.name || '');
  const resolvedPlayer2AuthUid =
    typeof data.player2AuthUid === 'string' && data.player2AuthUid
      ? data.player2AuthUid
      : players[1]?.authUid || null;
  const resolvedDiceRoll =
    typeof data.diceRoll === 'number'
      ? data.diceRoll
      : typeof gameState?.dice === 'number'
      ? gameState.dice
      : null;
  const resolvedLastMove: RoomLastMove | null =
    data.lastMove && typeof data.lastMove === 'object'
      ? (data.lastMove as RoomLastMove)
      : null;
  const resolvedHost: RoomParticipantInfo =
    data.host && typeof data.host === 'object' && data.host.id
      ? {
          id: String(data.host.id),
          name: String(data.host.name || resolvedPlayer1Name || 'Player 1'),
          symbol: data.host.symbol === 'O' ? 'O' : 'X',
          ...(typeof data.host.avatar === 'string' && data.host.avatar ? { avatar: data.host.avatar } : {}),
        }
      : {
          id: String(data.hostId || resolvedPlayer1Id || ''),
          name: resolvedPlayer1Name || 'Player 1',
          symbol: 'X',
          ...(players[0]?.avatar ? { avatar: players[0].avatar } : {}),
        };
  const resolvedGuest: RoomParticipantInfo | null =
    data.guest && typeof data.guest === 'object' && data.guest.id
      ? {
          id: String(data.guest.id),
          name: String(data.guest.name || resolvedPlayer2Name || 'Player 2'),
          symbol: data.guest.symbol === 'X' ? 'X' : 'O',
          ...(typeof data.guest.avatar === 'string' && data.guest.avatar ? { avatar: data.guest.avatar } : {}),
        }
      : resolvedPlayer2Id
      ? {
          id: resolvedPlayer2Id,
          name: resolvedPlayer2Name || 'Player 2',
          symbol: 'O',
          ...(players[1]?.avatar ? { avatar: players[1].avatar } : {}),
        }
      : null;
  const resolvedTurnUserId = String(
    data.currentTurnUserId || data.currentTurn || resolvedPlayer1Id || ''
  );
  const resolvedScores: Record<string, number> | undefined =
    data.scores && typeof data.scores === 'object'
      ? Object.fromEntries(
          Object.entries(data.scores).map(([k, v]) => [k, Number(v || 0)])
        )
      : gameState?.scores && typeof gameState.scores === 'object'
      ? Object.fromEntries(
          Object.entries(gameState.scores).map(([k, v]) => [k, Number(v || 0)])
        )
      : undefined;

  return {
    roomCode: String(data.roomCode || resolvedRoomId),
    roomId: resolvedRoomId,
    gameId: resolvedGameType,
    gameType: resolvedGameType,
    hostId: String(data.hostId || resolvedPlayer1Id || ''),
    host: resolvedHost,
    guest: resolvedGuest,
    player1: resolvedPlayer1Id,
    player1Id: resolvedPlayer1Id,
    player1AuthUid: resolvedPlayer1AuthUid,
    player1Name: resolvedPlayer1Name,
    player2: resolvedPlayer2Id || null,
    player2Id: resolvedPlayer2Id || null,
    player2AuthUid: resolvedPlayer2AuthUid,
    player2Name: resolvedPlayer2Name,
    createdAt: createdMs,
    lastUpdated: lastUpdatedMs,
    status: (data.status as MultiplayerRoom['status']) || 'waiting',
    maxPlayers,
    isPublicMatch: Boolean(data.isPublicMatch),
    isOpenGroup,
    activeSeatLimit,
    players,
    waitingPlayers,
    reactions,
    mutedVoiceIds,
    mutedChatIds,
    boardState: parsedBoardField,
    gameState,
    currentTurn: resolvedTurnUserId,
    currentTurnUserId: resolvedTurnUserId,
    scores: resolvedScores,
    winnerId: typeof data.winnerId === 'string' ? data.winnerId : null,
    isDraw: Boolean(data.isDraw),
    diceRoll: resolvedDiceRoll,
    lastMove: resolvedLastMove,
    messages,
    callState: null,
  };
}

const HOSTED_ROOM_STORAGE_PREFIX = 'jit_hosted_room_';
const PUBLIC_QUEUE_STALE_MS = 4 * 60 * 1000;
const PRIVATE_ROOM_STALE_MS = 5 * 60 * 1000;

let cachedServerTimeOffsetMs = 0;
let hasCalibratedServerClock = false;

function getServerSyncedNowMs(): number {
  return Date.now() + cachedServerTimeOffsetMs;
}

async function syncServerClockWithTicket(
  player: { id: string; name: string; avatar: string },
  gameId: string
): Promise<void> {
  if (!player.id) return;
  try {
    const ticketRef = doc(db, 'matchmakingQueue', player.id);
    const cleanName = (player.name || 'JIT Player').slice(0, 80);
    const cleanAvatar = sanitizeRoomAvatarUrl(player.avatar);
    const nowMs = Date.now();
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ticketRef);
      if (snap.exists()) {
        tx.update(ticketRef, {
          gameId,
          playerName: cleanName,
          playerAvatar: cleanAvatar,
          status: 'waiting',
          matchedRoomCode: '',
          matchedWithId: '',
          joinedAtMs: nowMs,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(ticketRef, {
          id: player.id,
          playerId: player.id,
          playerName: cleanName,
          playerAvatar: cleanAvatar,
          gameId,
          status: 'waiting',
          matchedRoomCode: '',
          matchedWithId: '',
          joinedAtMs: nowMs,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    const serverSnap = await getDocFromServer(ticketRef).catch(() => null);
    const ts = serverSnap?.exists() ? serverSnap.data()?.updatedAt : null;
    if (ts && typeof ts.toMillis === 'function') {
      cachedServerTimeOffsetMs = ts.toMillis() - Date.now();
      hasCalibratedServerClock = true;
    }
  } catch {
    // Best-effort server clock calibration
  }
}

function getStoredHostedRoomCode(hostId: string): string | null {
  if (typeof window === 'undefined' || !hostId) return null;
  try {
    const val = window.localStorage.getItem(`${HOSTED_ROOM_STORAGE_PREFIX}${hostId}`);
    const clean = normalizeRoomId(val);
    return clean || null;
  } catch {
    return null;
  }
}

function setStoredHostedRoomCode(hostId: string, roomCode: string | null): void {
  if (typeof window === 'undefined' || !hostId) return;
  try {
    const clean = normalizeRoomId(roomCode);
    if (clean) {
      window.localStorage.setItem(`${HOSTED_ROOM_STORAGE_PREFIX}${hostId}`, clean);
    } else {
      window.localStorage.removeItem(`${HOSTED_ROOM_STORAGE_PREFIX}${hostId}`);
    }
  } catch {
    // Ignore storage quota / private mode issues
  }
}

function getRoomUpdatedMs(data: Record<string, any>): number {
  if (data.lastUpdated && typeof data.lastUpdated.toMillis === 'function') {
    return data.lastUpdated.toMillis();
  }
  if (data.updatedAt && typeof data.updatedAt.toMillis === 'function') {
    return data.updatedAt.toMillis();
  }
  if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
    return data.createdAt.toMillis();
  }
  return getServerSyncedNowMs();
}

function isRoomDocStale(data: Record<string, any>, thresholdMs: number): boolean {
  const updatedMs = getRoomUpdatedMs(data);
  const effectiveThreshold = hasCalibratedServerClock
    ? thresholdMs
    : Math.max(thresholdMs, 2 * 60 * 60 * 1000);
  return getServerSyncedNowMs() - updatedMs > effectiveThreshold;
}

async function cleanupSingleHostedRoomDoc(
  code: string,
  hostId: string,
  data?: Record<string, any>
): Promise<void> {
  const cleanId = normalizeRoomId(code);
  if (!cleanId) return;
  const roomRef = doc(db, 'gameRooms', cleanId);
  try {
    let roomData = data;
    if (!roomData) {
      const snap = await getDocFromServer(roomRef).catch(() => getDoc(roomRef));
      if (!snap.exists()) return;
      roomData = snap.data();
    }
    const parsed = parseRoomSnapshotData(roomData);
    const totalMembers = parsed.players.length + (parsed.waitingPlayers?.length || 0);
    const isFinished = parsed.status === 'finished';
    const isStale = isRoomDocStale(roomData, PRIVATE_ROOM_STALE_MS);

    if (totalMembers <= 1 || isFinished || isStale) {
      await deleteDoc(roomRef);
      return;
    }

    // If a previous hosted room still had another member, gracefully expire/leave it
    if (parsed.hostId === hostId) {
      await updateDoc(roomRef, {
        status: 'finished',
        gameStateJson: JSON.stringify(parsed.gameState || {}),
        currentTurn: '',
        moveAction: 'HOST_REPLACED',
        lastUpdated: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      await deleteDoc(roomRef).catch(() => {});
      return;
    }

    if (
      parsed.players.some((p) => p.id === hostId) ||
      (parsed.waitingPlayers || []).some((p) => p.id === hostId)
    ) {
      await kickOrLeaveFirestoreRoom(cleanId, hostId);
    }
  } catch {
    // Best-effort cleanup of previous room
  }
}

export async function releasePreviousHostedRoom(
  hostId: string,
  preserveRoomCode?: string
): Promise<void> {
  if (!hostId) return;
  const cleanPreserve = normalizeRoomId(preserveRoomCode);
  const codesToClean = new Set<string>();
  const previousCode = getStoredHostedRoomCode(hostId);
  if (previousCode && previousCode !== cleanPreserve) {
    codesToClean.add(previousCode);
  }
  setStoredHostedRoomCode(hostId, cleanPreserve || null);

  // Query Firestore directly across devices/tabs for ALL previously hosted rooms by this user
  const docsByCode = new Map<string, Record<string, any>>();
  try {
    const q = query(
      collection(db, 'gameRooms'),
      where('hostId', '==', hostId),
      limit(50)
    );
    const snap = await getDocsFromServer(q).catch(() => getDocs(q));
    snap.docs.forEach((d) => {
      const code = normalizeRoomId(d.id);
      if (code && code !== cleanPreserve) {
        codesToClean.add(code);
        docsByCode.set(code, d.data());
      }
    });
  } catch {
    // Fallback to local stored code cleanup
  }

  if (codesToClean.size === 0) return;
  await Promise.allSettled(
    Array.from(codesToClean).map((code) =>
      cleanupSingleHostedRoomDoc(code, hostId, docsByCode.get(code))
    )
  );
}

async function pickAvailableRoomCodeAndCleanStale(hostId: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = Math.floor(1000 + Math.random() * 9000).toString();
    try {
      const candidateRef = doc(db, 'gameRooms', candidate);
      const snap = await getDocFromServer(candidateRef).catch(() => getDoc(candidateRef));
      if (!snap.exists()) {
        return candidate;
      }
      const existingData = snap.data();
      const playerCount = Number(existingData.playerCount || 1);
      const canRecycle =
        existingData.status === 'finished' ||
        existingData.hostId === hostId ||
        (playerCount <= 1 && isRoomDocStale(existingData, 2 * 60 * 1000)) ||
        isRoomDocStale(existingData, PRIVATE_ROOM_STALE_MS);

      if (canRecycle) {
        try {
          if (playerCount > 1 && existingData.status !== 'finished' && existingData.hostId === hostId) {
            await updateDoc(candidateRef, {
              status: 'finished',
              gameStateJson: String(existingData.gameStateJson || '{}'),
              currentTurn: '',
              moveAction: 'ROOM_RECYCLED',
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
          await deleteDoc(candidateRef);
          return candidate;
        } catch {
          // Another client owns an active room on this code; try next candidate
        }
      }
    } catch {
      // Transient read error; try next candidate
    }
  }
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function createFirestoreGameRoom(
  gameId: string,
  maxPlayers: number,
  hostPlayer: { id: string; name: string; avatar: string },
  isPublicMatchOrOptions:
    | boolean
    | { isPublicMatch?: boolean; isOpenGroup?: boolean; activeSeatLimit?: number; recycleRoomCode?: string } = false
): Promise<MultiplayerRoom> {
  const opts =
    typeof isPublicMatchOrOptions === 'boolean'
      ? { isPublicMatch: isPublicMatchOrOptions, isOpenGroup: false, activeSeatLimit: undefined, recycleRoomCode: undefined }
      : isPublicMatchOrOptions || {};
  const isPublicMatch = Boolean(opts.isPublicMatch);
  const isOpenGroup = Boolean(opts.isOpenGroup);
  const safeMax = isOpenGroup
    ? Math.min(999, Math.max(2, maxPlayers || 999))
    : Math.min(4, Math.max(2, maxPlayers || 2));
  const safeSeatLimit = isOpenGroup
    ? Math.min(8, Math.max(2, opts.activeSeatLimit || (gameId === 'truth_dare' ? 6 : gameId === 'ludo' ? 4 : 2)))
    : safeMax;

  // Auto-cleanup: delete/expire ALL previously hosted inactive/abandoned rooms for unlimited creation
  if (opts.recycleRoomCode) {
    await cleanupSingleHostedRoomDoc(opts.recycleRoomCode, hostPlayer.id).catch(() => {});
  }
  await releasePreviousHostedRoom(hostPlayer.id);

  const players: RoomPlayer[] = [
    {
      id: hostPlayer.id,
      ...(auth.currentUser?.uid ? { authUid: auth.currentUser.uid } : {}),
      name: (hostPlayer.name || 'JIT Player').slice(0, 80),
      avatar: sanitizeRoomAvatarUrl(hostPlayer.avatar),
      isHost: true,
      isReady: true,
      color: 'Red',
      joinedAtMs: Date.now(),
    },
  ];

  const initialStatus: MultiplayerRoom['status'] = isOpenGroup ? 'playing' : 'waiting';

  let lastErr: any = null;
  for (let createAttempt = 0; createAttempt < 12; createAttempt++) {
    const chosenCode = await pickAvailableRoomCodeAndCleanStale(hostPlayer.id);
    const hostDisplayName = (hostPlayer.name || 'JIT Player').slice(0, 80);
    const hostAuthUid = auth.currentUser?.uid || null;
    const hostInfo: RoomParticipantInfo = {
      id: hostPlayer.id,
      name: hostDisplayName,
      symbol: 'X',
      avatar: sanitizeRoomAvatarUrl(hostPlayer.avatar),
    };
    const initState = buildInitialGameStateForGame(gameId, `start_${Date.now()}`);
    const unifiedFields = buildUnifiedBoardAndMoveFields(initState, 'ROOM_CREATED', hostPlayer.id, null);
    const payload = {
      roomCode: chosenCode,
      roomId: chosenCode,
      gameId,
      gameType: gameId,
      hostId: hostPlayer.id,
      host: hostInfo,
      guest: null,
      player1: hostPlayer.id,
      player1Id: hostPlayer.id,
      player1AuthUid: hostAuthUid,
      player1Name: hostDisplayName,
      player2: null,
      player2Id: null,
      player2AuthUid: null,
      player2Name: '',
      status: initialStatus,
      maxPlayers: safeMax,
      playerCount: 1,
      isPublicMatch,
      isOpenGroup,
      activeSeatLimit: safeSeatLimit,
      playersJson: JSON.stringify(players),
      waitingPlayersJson: '[]',
      reactionsJson: '[]',
      mutedVoiceIdsJson: '[]',
      mutedChatIdsJson: '[]',
      gameStateJson: JSON.stringify(initState),
      ...unifiedFields,
      scores: { [hostPlayer.id]: 0 },
      winnerId: null,
      isDraw: false,
      messagesJson: '[]',
      moveAction: 'ROOM_CREATED',
      currentTurn: hostPlayer.id,
      currentTurnUserId: hostPlayer.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastUpdated: serverTimestamp(),
    };

    try {
      const created = await runTransaction(db, async (tx) => {
        const roomRef = doc(db, 'gameRooms', chosenCode);
        const existingSnap = await tx.get(roomRef);
        if (existingSnap.exists()) {
          throw new Error('ROOM_CODE_COLLISION');
        }
        tx.set(roomRef, payload);
        return true;
      });
      if (created) {
        setStoredHostedRoomCode(hostPlayer.id, chosenCode);
        return {
          roomCode: chosenCode,
          roomId: chosenCode,
          gameId,
          gameType: gameId,
          hostId: hostPlayer.id,
          host: hostInfo,
          guest: null,
          player1: hostPlayer.id,
          player1Id: hostPlayer.id,
          player1AuthUid: hostAuthUid,
          player1Name: hostDisplayName,
          player2: null,
          player2Id: null,
          player2AuthUid: null,
          player2Name: '',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          status: initialStatus,
          maxPlayers: safeMax,
          isPublicMatch,
          isOpenGroup,
          activeSeatLimit: safeSeatLimit,
          players,
          waitingPlayers: [],
          reactions: [],
          mutedVoiceIds: [],
          mutedChatIds: [],
          boardState: initState,
          gameState: initState,
          currentTurn: hostPlayer.id,
          currentTurnUserId: hostPlayer.id,
          scores: { [hostPlayer.id]: 0 },
          winnerId: null,
          isDraw: false,
          diceRoll: unifiedFields.diceRoll,
          lastMove: unifiedFields.lastMove,
          messages: [],
          callState: null,
        };
      }
    } catch (err: any) {
      lastErr = err;
      if (err?.message === 'ROOM_CODE_COLLISION') {
        await cleanupSingleHostedRoomDoc(chosenCode, hostPlayer.id).catch(() => {});
        continue;
      }
      if (err?.code === 'permission-denied' && createAttempt < 11) {
        continue;
      }
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.CREATE, `gameRooms/${chosenCode}`);
      }
      throw err;
    }
  }

  throw lastErr || new Error('Could not allocate a 4-digit room code right now. Please try again.');
}

export async function joinFirestoreGameRoom(
  roomCode: string,
  gameId: string | undefined,
  player: { id: string; name: string; avatar: string }
): Promise<MultiplayerRoom> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) {
    throw new Error('Please enter a valid 4-digit room code.');
  }

  const roomRef = doc(db, 'gameRooms', cleanCode);
  const seatColors = ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'];

  try {
    const resultRoom = await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) {
        throw new Error(`Room #${cleanCode} not found. Please verify the 4-digit code.`);
      }

      const data = snap.data();
      if (gameId && data.gameId !== gameId) {
        throw new Error(
          `Room #${cleanCode} is for ${String(data.gameId || '').toUpperCase()}, not ${gameId.toUpperCase()}.`
        );
      }

      const parsed = parseRoomSnapshotData(data);
      const currentWaiting = parsed.waitingPlayers || [];
      const alreadyJoined =
        parsed.players.some((p) => p.id === player.id) ||
        currentWaiting.some((p) => p.id === player.id);
      if (alreadyJoined) {
        return parsed;
      }

      if (parsed.isOpenGroup) {
        const seatLimit = Math.max(
          2,
          parsed.activeSeatLimit ||
            (parsed.gameId === 'truth_dare' ? 6 : parsed.gameId === 'ludo' ? 4 : 2)
        );
        const hasOpenActiveSeat = parsed.players.length < seatLimit;
        const newEntry: RoomPlayer = {
          id: player.id,
          ...(auth.currentUser?.uid ? { authUid: auth.currentUser.uid } : {}),
          name: (player.name || 'JIT Player').slice(0, 80),
          avatar: sanitizeRoomAvatarUrl(player.avatar),
          isHost: false,
          isReady: true,
          color: seatColors[(parsed.players.length + currentWaiting.length) % seatColors.length],
          joinedAtMs: Date.now(),
        };

        const nextPlayers = hasOpenActiveSeat ? [...parsed.players, newEntry] : parsed.players;
        const nextWaiting = hasOpenActiveSeat ? currentWaiting : [...currentWaiting, newEntry];
        const nextCount = Math.min(500, nextPlayers.length + nextWaiting.length);

        tx.update(roomRef, {
          playersJson: JSON.stringify(nextPlayers),
          waitingPlayersJson: JSON.stringify(nextWaiting),
          player1: nextPlayers[0]?.id || parsed.hostId,
          player1Id: nextPlayers[0]?.id || parsed.hostId,
          player1Name: nextPlayers[0]?.name || parsed.player1Name || '',
          player2: nextPlayers[1]?.id || null,
          player2Id: nextPlayers[1]?.id || null,
          player2Name: nextPlayers[1]?.name || '',
          playerCount: nextCount,
          hostId: parsed.hostId,
          status: 'active',
          lastUpdated: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        return {
          ...parsed,
          roomId: parsed.roomCode,
          player1: nextPlayers[0]?.id || parsed.hostId,
          player1Id: nextPlayers[0]?.id || parsed.hostId,
          player1Name: nextPlayers[0]?.name || parsed.player1Name || '',
          player2: nextPlayers[1]?.id || null,
          player2Id: nextPlayers[1]?.id || null,
          player2Name: nextPlayers[1]?.name || '',
          status: 'active' as const,
          players: nextPlayers,
          waitingPlayers: nextWaiting,
        };
      }

      if (parsed.players.length >= parsed.maxPlayers) {
        throw new Error(`Room #${cleanCode} is full (max ${parsed.maxPlayers} players).`);
      }

      const nextPlayers: RoomPlayer[] = [
        ...parsed.players,
        {
          id: player.id,
          ...(auth.currentUser?.uid ? { authUid: auth.currentUser.uid } : {}),
          name: (player.name || 'JIT Player').slice(0, 80),
          avatar: sanitizeRoomAvatarUrl(player.avatar),
          isHost: false,
          isReady: true,
          color: seatColors[parsed.players.length % seatColors.length],
          joinedAtMs: Date.now(),
        },
      ];

      // Auto-start as soon as 2nd player joins (or room reaches capacity)
      const nextStatus: MultiplayerRoom['status'] =
        nextPlayers.length >= 2 ? 'playing' : parsed.status;
      const isStarting = nextStatus === 'playing' || nextStatus === 'active' || nextStatus === 'in_game';
      const startId = `start_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const nextGameState =
        isStarting && !parsed.gameState?._startId
          ? buildInitialGameStateForGame(parsed.gameId, startId, parsed.gameState || {})
          : parsed.gameState || {};

      const p1Id = nextPlayers[0]?.id || parsed.hostId;
      const p1Name = nextPlayers[0]?.name || parsed.player1Name || '';
      const p1AuthUid = nextPlayers[0]?.authUid || parsed.player1AuthUid || null;
      const p2Id = nextPlayers[1]?.id || '';
      const p2Name = nextPlayers[1]?.name || '';
      const p2AuthUid = nextPlayers[1]?.authUid || auth.currentUser?.uid || null;
      const hostInfo: RoomParticipantInfo = {
        id: p1Id,
        name: p1Name || 'Player 1',
        symbol: 'X',
        avatar: nextPlayers[0]?.avatar || '',
      };
      const guestInfo: RoomParticipantInfo | null = p2Id
        ? {
            id: p2Id,
            name: p2Name || 'Player 2',
            symbol: 'O',
            avatar: nextPlayers[1]?.avatar || '',
          }
        : null;
      const mergedScores: Record<string, number> = {
        ...(parsed.scores || {}),
        ...(p1Id ? { [p1Id]: Number(parsed.scores?.[p1Id] || 0) } : {}),
        ...(p2Id ? { [p2Id]: Number(parsed.scores?.[p2Id] || 0) } : {}),
      };
      const firstTurnId = nextPlayers[0]?.id || parsed.hostId;
      const unifiedStartFields = isStarting
        ? buildUnifiedBoardAndMoveFields(nextGameState, 'GAME_START', player.id)
        : null;

      tx.update(roomRef, {
        roomId: parsed.roomCode,
        gameType: parsed.gameId,
        playersJson: JSON.stringify(nextPlayers),
        host: hostInfo,
        guest: guestInfo,
        player1: p1Id,
        player1Id: p1Id,
        player1AuthUid: p1AuthUid,
        player1Name: p1Name,
        player2: p2Id || null,
        player2Id: p2Id || null,
        player2AuthUid: p2AuthUid,
        player2Name: p2Name,
        playerCount: nextPlayers.length,
        hostId: parsed.hostId,
        scores: mergedScores,
        winnerId: null,
        isDraw: false,
        status: nextStatus,
        ...(isStarting && unifiedStartFields
          ? {
              gameStateJson: JSON.stringify(nextGameState),
              ...unifiedStartFields,
              moveAction: 'GAME_START',
              currentTurn: firstTurnId,
              currentTurnUserId: firstTurnId,
            }
          : {}),
        lastUpdated: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return {
        ...parsed,
        roomId: parsed.roomCode,
        gameType: parsed.gameId,
        host: hostInfo,
        guest: guestInfo,
        player1: p1Id,
        player1Id: p1Id,
        player1AuthUid: p1AuthUid,
        player1Name: p1Name,
        player2: p2Id,
        player2Id: p2Id,
        player2AuthUid: p2AuthUid,
        player2Name: p2Name,
        scores: mergedScores,
        winnerId: null,
        isDraw: false,
        status: nextStatus,
        players: nextPlayers,
        ...(isStarting && unifiedStartFields
          ? {
              boardState: nextGameState,
              gameState: nextGameState,
              diceRoll: unifiedStartFields.diceRoll,
              lastMove: unifiedStartFields.lastMove,
              currentTurn: firstTurnId,
              currentTurnUserId: firstTurnId,
            }
          : {}),
      };
    });

    return resultRoom;
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    throw err;
  }
}

export async function listPublicOpenGroupRooms(gameId?: string): Promise<MultiplayerRoom[]> {
  try {
    // Single-field query avoids composite index failures
    const q = query(
      collection(db, 'gameRooms'),
      where('isPublicMatch', '==', true),
      limit(60)
    );
    const snap = await getDocs(q);
    const roomsList: MultiplayerRoom[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const parsed = parseRoomSnapshotData(data);
      if (!parsed.isOpenGroup) continue;
      if (gameId && parsed.gameId !== gameId) continue;
      if (parsed.players.length === 0) continue;
      if (isRoomDocStale(data, PRIVATE_ROOM_STALE_MS * 3)) continue;
      roomsList.push(parsed);
    }
    return roomsList.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function isPlayer2Unassigned(data: Record<string, any>, parsed: MultiplayerRoom): boolean {
  const rawP2 = data.player2;
  const rawP2Id = data.player2Id;
  const hasRawP2 =
    (typeof rawP2 === 'string' && rawP2.trim().length > 0) ||
    (typeof rawP2Id === 'string' && rawP2Id.trim().length > 0);
  const hasParsedP2 = Boolean(parsed.player2 && parsed.player2.trim().length > 0) || Boolean(parsed.player2Id && parsed.player2Id.trim().length > 0);
  return !hasRawP2 && !hasParsedP2 && parsed.players.length < 2;
}

function filterActiveWaitingRooms(
  docs: Array<{ data: () => Record<string, any>; id?: string }>,
  gameId: string,
  excludeRoomCode: string,
  playerId: string
): MultiplayerRoom[] {
  const active: MultiplayerRoom[] = [];
  for (const d of docs) {
    const data = d.data();
    const parsed = parseRoomSnapshotData({
      ...data,
      roomId: data.roomId || data.roomCode || d.id || '',
      roomCode: data.roomCode || data.roomId || d.id || '',
    });
    // Match any open public waiting room for this game (never hijack private Friend rooms or Open Group rooms)
    if (
      data.isPublicMatch === false ||
      parsed.isOpenGroup ||
      parsed.status !== 'waiting' ||
      (parsed.gameType !== gameId && parsed.gameId !== gameId)
    ) {
      continue;
    }
    if (!isPlayer2Unassigned(data, parsed)) {
      continue;
    }
    if (isRoomDocStale(data, PUBLIC_QUEUE_STALE_MS)) {
      const staleId = normalizeRoomId(parsed.roomId || parsed.roomCode || d.id);
      if (parsed.players.length <= 1 && staleId) {
        deleteDoc(doc(db, 'gameRooms', staleId)).catch(() => {});
      }
      continue;
    }
    if (parsed.roomCode === excludeRoomCode || parsed.roomId === excludeRoomCode) continue;
    const currentAuthUid = auth.currentUser?.uid || '';
    if (
      parsed.player1Id === playerId ||
      parsed.player1 === playerId ||
      parsed.hostId === playerId ||
      (currentAuthUid &&
        (parsed.player1Id === currentAuthUid || parsed.player1AuthUid === currentAuthUid)) ||
      parsed.players.some((p) => p.id === playerId)
    ) {
      continue;
    }
    active.push(parsed);
  }
  return active.sort((a, b) =>
    a.createdAt !== b.createdAt
      ? a.createdAt - b.createdAt
      : a.roomCode.localeCompare(b.roomCode)
  );
}

async function listWaitingQuickMatchRooms(
  gameId: string,
  excludeRoomCode: string,
  playerId: string
): Promise<MultiplayerRoom[]> {
  try {
    // Query waiting rooms for the selected gameType directly (two equality filters work without custom composite indexes)
    const byTypeQ = query(
      collection(db, 'gameRooms'),
      where('gameType', '==', gameId),
      where('status', '==', 'waiting'),
      limit(50)
    );
    const byGameIdQ = query(
      collection(db, 'gameRooms'),
      where('gameId', '==', gameId),
      where('status', '==', 'waiting'),
      limit(50)
    );
    const [typeSnap, idSnap] = await Promise.all([
      getDocsFromServer(byTypeQ).catch(() => getDocs(byTypeQ)),
      getDocsFromServer(byGameIdQ).catch(() => getDocs(byGameIdQ)),
    ]);

    const mergedById = new Map<string, { data: () => Record<string, any>; id?: string }>();
    typeSnap.docs.forEach((d) => mergedById.set(d.id, d));
    idSnap.docs.forEach((d) => mergedById.set(d.id, d));

    if (mergedById.size === 0) {
      const broadQ = query(
        collection(db, 'gameRooms'),
        where('status', '==', 'waiting'),
        limit(100)
      );
      const broadSnap = await getDocsFromServer(broadQ).catch(() => getDocs(broadQ));
      broadSnap.docs.forEach((d) => mergedById.set(d.id, d));
    }

    return filterActiveWaitingRooms(
      Array.from(mergedById.values()),
      gameId,
      excludeRoomCode,
      playerId
    );
  } catch {
    return [];
  }
}

export async function findOtherWaitingQuickMatchRoom(
  gameId: string,
  excludeRoomCode: string,
  playerId: string
): Promise<MultiplayerRoom | null> {
  const candidates = await listWaitingQuickMatchRooms(gameId, excludeRoomCode, playerId);
  return candidates[0] || null;
}

export function subscribeToPublicMatchmakingQueue(
  gameId: string,
  excludeRoomCode: string,
  playerId: string,
  onWaitingRooms: (rooms: MultiplayerRoom[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'gameRooms'),
    where('gameType', '==', gameId),
    where('status', '==', 'waiting'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const waiting = filterActiveWaitingRooms(snap.docs, gameId, excludeRoomCode, playerId);
      onWaitingRooms(waiting);
    },
    (err) => {
      console.warn('Public matchmaking queue listener notice:', err);
    }
  );
}

export interface MatchmakingTicket {
  id: string;
  playerId: string;
  playerName: string;
  playerAvatar: string;
  gameId: string;
  status: 'waiting' | 'matched';
  matchedRoomCode: string;
  matchedWithId: string;
  joinedAtMs: number;
}

function parseMatchmakingTicket(data: Record<string, any>): MatchmakingTicket {
  return {
    id: String(data.id || data.playerId || ''),
    playerId: String(data.playerId || data.id || ''),
    playerName: String(data.playerName || 'JIT Player'),
    playerAvatar: String(data.playerAvatar || ''),
    gameId: String(data.gameId || 'tictactoe'),
    status: data.status === 'matched' ? 'matched' : 'waiting',
    matchedRoomCode: String(data.matchedRoomCode || ''),
    matchedWithId: String(data.matchedWithId || ''),
    joinedAtMs: Number(data.joinedAtMs || Date.now()),
  };
}

function filterActiveQueueTickets(
  docs: Array<{ data: () => Record<string, any> }>,
  gameId: string,
  excludePlayerId: string
): MatchmakingTicket[] {
  const active: MatchmakingTicket[] = [];
  for (const d of docs) {
    const data = d.data();
    const ticket = parseMatchmakingTicket(data);
    if (ticket.status !== 'waiting' || ticket.gameId !== gameId) {
      continue;
    }
    if (!ticket.playerId || ticket.playerId === excludePlayerId) {
      continue;
    }
    if (isRoomDocStale(data, PUBLIC_QUEUE_STALE_MS)) {
      deleteDoc(doc(db, 'matchmakingQueue', ticket.playerId)).catch(() => {});
      continue;
    }
    active.push(ticket);
  }
  return active.sort((a, b) =>
    a.joinedAtMs !== b.joinedAtMs
      ? a.joinedAtMs - b.joinedAtMs
      : a.playerId.localeCompare(b.playerId)
  );
}

export async function fetchFirestoreGameRoomByCode(roomCode: string): Promise<MultiplayerRoom | null> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return null;
  try {
    const snap = await fetchDocServerFirst(['gameRooms', cleanCode]);
    if (!snap.exists()) return null;
    return parseRoomSnapshotData(snap.data());
  } catch {
    return null;
  }
}

export async function leaveMatchmakingQueue(playerId: string): Promise<void> {
  if (!playerId) return;
  try {
    await deleteDoc(doc(db, 'matchmakingQueue', playerId));
  } catch {
    // Best-effort queue cleanup
  }
}

export async function touchMatchmakingQueueHeartbeat(playerId: string): Promise<void> {
  if (!playerId) return;
  try {
    await updateDoc(doc(db, 'matchmakingQueue', playerId), {
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore transient heartbeat errors
  }
}

export async function findWaitingQueueTicketForGame(
  gameId: string,
  excludePlayerId: string
): Promise<MatchmakingTicket | null> {
  try {
    const q = query(
      collection(db, 'matchmakingQueue'),
      where('status', '==', 'waiting'),
      limit(50)
    );
    const snap = await getDocs(q);
    const candidates = filterActiveQueueTickets(snap.docs, gameId, excludePlayerId);
    return candidates[0] || null;
  } catch {
    return null;
  }
}

export function subscribeToMatchmakingQueueForGame(
  gameId: string,
  excludePlayerId: string,
  onWaitingTickets: (tickets: MatchmakingTicket[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'matchmakingQueue'),
    where('status', '==', 'waiting'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const tickets = filterActiveQueueTickets(snap.docs, gameId, excludePlayerId);
      onWaitingTickets(tickets);
    },
    (err) => {
      console.warn('Matchmaking queue collection listener notice:', err);
    }
  );
}

export function subscribeToMyMatchmakingTicket(
  playerId: string,
  onMatchedRoom: (roomCode: string, matchedWithId: string) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'matchmakingQueue', playerId),
    (snap) => {
      if (!snap.exists()) return;
      const ticket = parseMatchmakingTicket(snap.data());
      const normalizedMatchedRoom = normalizeRoomId(ticket.matchedRoomCode);
      if (ticket.status === 'matched' && normalizedMatchedRoom) {
        onMatchedRoom(normalizedMatchedRoom, ticket.matchedWithId);
      }
    },
    (err) => {
      console.warn('My matchmaking ticket listener notice:', err);
    }
  );
}

async function enterMatchmakingQueueTicket(
  player: { id: string; name: string; avatar: string },
  gameId: string
): Promise<MatchmakingTicket> {
  const ticketRef = doc(db, 'matchmakingQueue', player.id);
  const nowMs = Date.now();
  const cleanAvatar = sanitizeAvatarUrl(player.avatar);
  const cleanName = (player.name || 'JIT Player').slice(0, 80);

  await runTransaction(db, async (tx) => {
    const existingSnap = await tx.get(ticketRef);
    if (existingSnap.exists()) {
      tx.update(ticketRef, {
        gameId,
        playerName: cleanName,
        playerAvatar: cleanAvatar,
        status: 'waiting',
        matchedRoomCode: '',
        matchedWithId: '',
        joinedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.set(ticketRef, {
        id: player.id,
        playerId: player.id,
        playerName: cleanName,
        playerAvatar: cleanAvatar,
        gameId,
        status: 'waiting',
        matchedRoomCode: '',
        matchedWithId: '',
        joinedAtMs: nowMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  return {
    id: player.id,
    playerId: player.id,
    playerName: cleanName,
    playerAvatar: cleanAvatar,
    gameId,
    status: 'waiting',
    matchedRoomCode: '',
    matchedWithId: '',
    joinedAtMs: nowMs,
  };
}

export async function pairQueuePlayersIntoRoom(
  initiator: { id: string; name: string; avatar: string },
  opponentTicket: MatchmakingTicket,
  gameId: string,
  maxPlayers = 2
): Promise<MultiplayerRoom | null> {
  if (!opponentTicket?.playerId || opponentTicket.playerId === initiator.id) {
    return null;
  }
  const safeMax = Math.min(4, Math.max(2, maxPlayers || 2));
  const oppRef = doc(db, 'matchmakingQueue', opponentTicket.playerId);
  const myRef = doc(db, 'matchmakingQueue', initiator.id);

  for (let attempt = 0; attempt < 4; attempt++) {
    const roomCode = await pickAvailableRoomCodeAndCleanStale(initiator.id);
    const roomRef = doc(db, 'gameRooms', roomCode);

    try {
      const txResult = await runTransaction(db, async (tx) => {
        const oppSnap = await tx.get(oppRef);
        const mySnap = await tx.get(myRef);
        const roomSnap = await tx.get(roomRef);

        // If our own queue ticket was already matched by the other player concurrently, use THAT room!
        if (mySnap.exists()) {
          const myData = mySnap.data();
          const matchedCode = normalizeRoomId(String(myData.matchedRoomCode || ''));
          if (myData.status === 'matched' && matchedCode) {
            return { existingRoomCode: matchedCode, room: null as MultiplayerRoom | null };
          }
        }

        if (!oppSnap.exists()) {
          return { existingRoomCode: null, room: null as MultiplayerRoom | null };
        }
        const oppData = oppSnap.data();
        if (oppData.status !== 'waiting' || oppData.gameId !== gameId) {
          return { existingRoomCode: null, room: null as MultiplayerRoom | null };
        }

        if (roomSnap.exists()) {
          throw new Error('ROOM_CODE_COLLISION');
        }

        const startId = `start_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const oppPlayer: RoomPlayer = {
          id: opponentTicket.playerId,
          name: String(oppData.playerName || opponentTicket.playerName || 'Player 1').slice(0, 80),
          avatar: sanitizeAvatarUrl(String(oppData.playerAvatar || opponentTicket.playerAvatar || '')),
          isHost: true,
          isReady: true,
          color: 'Red',
          joinedAtMs: Number(oppData.joinedAtMs || Date.now()),
        };
        const initPlayer: RoomPlayer = {
          id: initiator.id,
          ...(auth.currentUser?.uid ? { authUid: auth.currentUser.uid } : {}),
          name: initiator.name.slice(0, 80),
          avatar: sanitizeAvatarUrl(initiator.avatar),
          isHost: false,
          isReady: true,
          color: 'Yellow',
          joinedAtMs: Date.now(),
        };
        const pairedPlayers = [oppPlayer, initPlayer];
        const initialPairedGameState = buildInitialGameStateForGame(gameId, startId);
        const unifiedPaired = buildUnifiedBoardAndMoveFields(initialPairedGameState, 'GAME_START', initiator.id);
        const oppAuthUid = typeof oppData.playerAuthUid === 'string' ? oppData.playerAuthUid : null;
        const initAuthUid = auth.currentUser?.uid || null;
        if (oppAuthUid) {
          oppPlayer.authUid = oppAuthUid;
        }

        tx.set(roomRef, {
          roomCode,
          roomId: roomCode,
          gameId,
          gameType: gameId,
          hostId: oppPlayer.id,
          player1: oppPlayer.id,
          player1Id: oppPlayer.id,
          player1AuthUid: oppAuthUid,
          player1Name: oppPlayer.name,
          player2: initPlayer.id,
          player2Id: initPlayer.id,
          player2AuthUid: initAuthUid,
          player2Name: initPlayer.name,
          status: 'active',
          maxPlayers: safeMax,
          playerCount: 2,
          isPublicMatch: true,
          isOpenGroup: false,
          activeSeatLimit: safeMax,
          playersJson: JSON.stringify(pairedPlayers),
          waitingPlayersJson: '[]',
          reactionsJson: '[]',
          mutedVoiceIdsJson: '[]',
          mutedChatIdsJson: '[]',
          gameStateJson: JSON.stringify(initialPairedGameState),
          ...unifiedPaired,
          messagesJson: '[]',
          moveAction: 'GAME_START',
          currentTurn: oppPlayer.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.update(oppRef, {
          status: 'matched',
          matchedRoomCode: roomCode,
          matchedWithId: initiator.id,
          updatedAt: serverTimestamp(),
        });

        if (mySnap.exists()) {
          tx.update(myRef, {
            status: 'matched',
            matchedRoomCode: roomCode,
            matchedWithId: oppPlayer.id,
            updatedAt: serverTimestamp(),
          });
        }

        const createdRoom: MultiplayerRoom = {
          roomCode,
          roomId: roomCode,
          gameId,
          gameType: gameId,
          hostId: oppPlayer.id,
          player1: oppPlayer.id,
          player1Id: oppPlayer.id,
          player1AuthUid: oppAuthUid,
          player1Name: oppPlayer.name,
          player2: initPlayer.id,
          player2Id: initPlayer.id,
          player2AuthUid: initAuthUid,
          player2Name: initPlayer.name,
          createdAt: Date.now(),
          status: 'active',
          maxPlayers: safeMax,
          isPublicMatch: true,
          isOpenGroup: false,
          activeSeatLimit: safeMax,
          players: pairedPlayers,
          waitingPlayers: [],
          reactions: [],
          mutedVoiceIds: [],
          mutedChatIds: [],
          boardState: initialPairedGameState,
          gameState: initialPairedGameState,
          currentTurn: oppPlayer.id,
          diceRoll: unifiedPaired.diceRoll,
          lastMove: unifiedPaired.lastMove,
          messages: [],
          callState: null,
        };

        return { existingRoomCode: null, room: createdRoom };
      });

      if (txResult.existingRoomCode) {
        const fetched = await fetchFirestoreGameRoomByCode(txResult.existingRoomCode);
        await leaveMatchmakingQueue(initiator.id);
        if (fetched) return fetched;
      }

      if (txResult.room) {
        setStoredHostedRoomCode(initiator.id, null);
        await leaveMatchmakingQueue(initiator.id);
        return txResult.room;
      }

      return null;
    } catch (err: any) {
      if (err?.message === 'ROOM_CODE_COLLISION') {
        continue;
      }
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.WRITE, `matchmakingQueue/${opponentTicket.playerId}`);
      }
      throw err;
    }
  }

  return null;
}

export async function touchMatchmakingRoomHeartbeat(roomCode: string): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  try {
    await updateDoc(doc(db, 'gameRooms', cleanCode), {
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore transient heartbeat failures
  }
}

export async function releasePublicQueueSlotIfOwner(
  gameId: string,
  playerId: string,
  roomCode?: string
): Promise<void> {
  if (!gameId || !playerId) return;
  const slotId = `slot_${gameId}`;
  const slotRef = doc(db, 'matchmakingQueue', slotId);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(slotRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const ownsSlot = data.playerId === playerId && data.status === 'waiting';
      const matchesRoom = !roomCode || String(data.matchedRoomCode || '') === roomCode;
      if (ownsSlot && matchesRoom) {
        tx.update(slotRef, {
          status: 'matched',
          matchedRoomCode: '',
          matchedWithId: '',
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch {
    // Best-effort slot release
  }
  await leaveMatchmakingQueue(playerId).catch(() => {});
}

export async function tryAtomicallyJoinWaitingRoom(
  roomCode: string,
  gameId: string,
  player: { id: string; name: string; avatar: string }
): Promise<MultiplayerRoom | null> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return null;

  const roomRef = doc(db, 'gameRooms', cleanCode);
  const slotRef = doc(db, 'matchmakingQueue', `slot_${gameId}`);
  const cleanName = (player.name || 'JIT Player').slice(0, 80);
  const cleanAvatar = sanitizeRoomAvatarUrl(player.avatar);
  const seatColors = ['Red', 'Yellow', 'Green', 'Blue'];

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const slotSnap = await tx.get(slotRef);
    if (!snap.exists()) return null;

    const data = snap.data();
    const parsed = parseRoomSnapshotData(data);
    const currentAuthUid = auth.currentUser?.uid || '';
    if (
      data.isPublicMatch === false ||
      parsed.isOpenGroup ||
      (parsed.gameType !== gameId && parsed.gameId !== gameId) ||
      parsed.status !== 'waiting' ||
      !isPlayer2Unassigned(data, parsed) ||
      parsed.player1Id === player.id ||
      parsed.player1 === player.id ||
      parsed.hostId === player.id ||
      (currentAuthUid &&
        (parsed.player1Id === currentAuthUid || parsed.player1AuthUid === currentAuthUid)) ||
      parsed.players.some((p) => p.id === player.id)
    ) {
      return null;
    }

    const nextPlayers: RoomPlayer[] = [
      ...parsed.players,
      {
        id: player.id,
        ...(auth.currentUser?.uid ? { authUid: auth.currentUser.uid } : {}),
        name: cleanName,
        avatar: cleanAvatar,
        isHost: false,
        isReady: true,
        color: seatColors[parsed.players.length % seatColors.length],
        joinedAtMs: Date.now(),
      },
    ];
    const joinedPlayer1Id = nextPlayers[0]?.id || parsed.hostId;
    const joinedPlayer1Name = nextPlayers[0]?.name || parsed.player1Name || '';
    const joinedPlayer1AuthUid = nextPlayers[0]?.authUid || parsed.player1AuthUid || null;
    const joinedPlayer2Id = nextPlayers[1]?.id || player.id;
    const joinedPlayer2Name = nextPlayers[1]?.name || cleanName;
    const joinedPlayer2AuthUid = nextPlayers[1]?.authUid || auth.currentUser?.uid || null;
    const nextStatus: MultiplayerRoom['status'] = 'playing';
    const startId = `start_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nextGameState = buildInitialGameStateForGame(gameId, startId, parsed.gameState || {});
    const unifiedJoin = buildUnifiedBoardAndMoveFields(nextGameState, 'GAME_START', player.id);
    const hostInfo: RoomParticipantInfo = {
      id: joinedPlayer1Id,
      name: joinedPlayer1Name || 'Player 1',
      symbol: 'X',
      avatar: nextPlayers[0]?.avatar || '',
    };
    const guestInfo: RoomParticipantInfo = {
      id: joinedPlayer2Id,
      name: joinedPlayer2Name || 'Player 2',
      symbol: 'O',
      avatar: cleanAvatar,
    };
    const initialScores = { [joinedPlayer1Id]: 0, [joinedPlayer2Id]: 0 };

    tx.update(roomRef, {
      roomId: cleanCode,
      gameType: gameId,
      playersJson: JSON.stringify(nextPlayers),
      host: hostInfo,
      guest: guestInfo,
      player1: joinedPlayer1Id,
      player1Id: joinedPlayer1Id,
      player1AuthUid: joinedPlayer1AuthUid,
      player1Name: joinedPlayer1Name,
      player2: joinedPlayer2Id,
      player2Id: joinedPlayer2Id,
      player2AuthUid: joinedPlayer2AuthUid,
      player2Name: joinedPlayer2Name,
      playerCount: nextPlayers.length,
      hostId: parsed.hostId,
      isPublicMatch: true,
      scores: initialScores,
      winnerId: null,
      isDraw: false,
      status: nextStatus,
      gameStateJson: JSON.stringify(nextGameState),
      ...unifiedJoin,
      moveAction: 'GAME_START',
      currentTurn: joinedPlayer1Id,
      currentTurnUserId: joinedPlayer1Id,
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (slotSnap.exists() && slotSnap.data().matchedRoomCode === cleanCode) {
      tx.update(slotRef, {
        status: 'matched',
        matchedRoomCode: cleanCode,
        matchedWithId: player.id,
        updatedAt: serverTimestamp(),
      });
    }

    return {
      ...parsed,
      roomCode: cleanCode,
      roomId: cleanCode,
      gameType: gameId,
      host: hostInfo,
      guest: guestInfo,
      player1: joinedPlayer1Id,
      player1Id: joinedPlayer1Id,
      player1AuthUid: joinedPlayer1AuthUid,
      player1Name: joinedPlayer1Name,
      player2: joinedPlayer2Id,
      player2Id: joinedPlayer2Id,
      player2AuthUid: joinedPlayer2AuthUid,
      player2Name: joinedPlayer2Name,
      isPublicMatch: true,
      scores: initialScores,
      winnerId: null,
      isDraw: false,
      status: nextStatus,
      players: nextPlayers,
      boardState: nextGameState,
      gameState: nextGameState,
      diceRoll: unifiedJoin.diceRoll,
      lastMove: unifiedJoin.lastMove,
      currentTurn: joinedPlayer1Id,
      currentTurnUserId: joinedPlayer1Id,
    };
  });
}

export async function quickMatchFirestoreRoom(
  gameId: string,
  maxPlayers: number,
  player: { id: string; name: string; avatar: string }
): Promise<{ room: MultiplayerRoom; matchedExisting: boolean }> {
  const safeMax = Math.min(4, Math.max(2, maxPlayers || 2));
  const cleanName = (player.name || 'JIT Player').slice(0, 80);
  const cleanAvatar = sanitizeRoomAvatarUrl(player.avatar);
  const slotId = `slot_${gameId}`;
  const slotRef = doc(db, 'matchmakingQueue', slotId);

  // Release any prior orphaned rooms hosted by this user; calibrate server clock non-blocking
  await releasePreviousHostedRoom(player.id).catch(() => {});
  void syncServerClockWithTicket(player, gameId);

  let lastErr: any = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    // 1. Query Firestore for oldest waiting room where status === 'waiting' & player2Id is empty/null & player1Id !== currentUserId
    const earliestWaiting = await findOtherWaitingQuickMatchRoom(gameId, '', player.id).catch(() => null);
    if (earliestWaiting) {
      try {
        const joined = await tryAtomicallyJoinWaitingRoom(earliestWaiting.roomCode, gameId, player);
        if (joined) {
          await leaveMatchmakingQueue(player.id).catch(() => {});
          setStoredHostedRoomCode(player.id, null);
          return { room: joined, matchedExisting: true };
        }
      } catch {
        // Claimed concurrently; retry transaction check below
      }
    }

    // 2. Atomic Firestore creation with unique auto-generated room ID: doc(collection(db, 'gameRooms'))
    const autoRoomRef = doc(collection(db, 'gameRooms'));
    const generatedRoomId = autoRoomRef.id;

    try {
      const result = await runTransaction(db, async (tx) => {
        const slotSnap = await tx.get(slotRef);
        const slotData = slotSnap.exists() ? slotSnap.data() : null;
        const slotRoomId = normalizeRoomId(slotData ? String(slotData.matchedRoomCode || '') : '');
        const slotNotStale =
          Boolean(slotData) && !isRoomDocStale(slotData || {}, PUBLIC_QUEUE_STALE_MS);

        if (slotData && slotData.status === 'waiting' && slotData.gameId === gameId && slotRoomId && slotNotStale) {
          const waitingRoomRef = doc(db, 'gameRooms', slotRoomId);
          const waitingRoomSnap = await tx.get(waitingRoomRef);
          if (waitingRoomSnap.exists()) {
            const rawWaitingData = waitingRoomSnap.data();
            const parsedWaiting = parseRoomSnapshotData(rawWaitingData);
            if (
              String(slotData.playerId || '') === player.id &&
              !parsedWaiting.isOpenGroup &&
              parsedWaiting.gameId === gameId &&
              parsedWaiting.status === 'waiting' &&
              parsedWaiting.players.some((p) => p.id === player.id)
            ) {
              tx.update(waitingRoomRef, {
                lastUpdated: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              tx.update(slotRef, { updatedAt: serverTimestamp() });
              return {
                matchedExisting: false,
                room: parsedWaiting,
              };
            }

            const canForceJoin =
              String(slotData.playerId || '') !== player.id &&
              rawWaitingData.isPublicMatch !== false &&
              !parsedWaiting.isOpenGroup &&
              parsedWaiting.gameId === gameId &&
              parsedWaiting.status === 'waiting' &&
              isPlayer2Unassigned(rawWaitingData, parsedWaiting) &&
              !parsedWaiting.players.some((p) => p.id === player.id) &&
              !isRoomDocStale(rawWaitingData, PUBLIC_QUEUE_STALE_MS);

            if (canForceJoin) {
              const startId = `start_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const hostPlayer = parsedWaiting.players[0];
              const seatColors = ['Red', 'Yellow', 'Green', 'Blue'];
              const nextPlayers: RoomPlayer[] = [
                ...parsedWaiting.players,
                {
                  id: player.id,
                  ...(auth.currentUser?.uid ? { authUid: auth.currentUser.uid } : {}),
                  name: cleanName,
                  avatar: cleanAvatar,
                  isHost: false,
                  isReady: true,
                  color: seatColors[parsedWaiting.players.length % seatColors.length],
                  joinedAtMs: Date.now(),
                },
              ];
              const joinedPlayer1Id = hostPlayer?.id || parsedWaiting.hostId;
              const joinedPlayer1Name = hostPlayer?.name || parsedWaiting.player1Name || 'Player 1';
              const joinedPlayer1AuthUid = hostPlayer?.authUid || parsedWaiting.player1AuthUid || null;
              const joinedPlayer2Id = nextPlayers[1]?.id || player.id;
              const joinedPlayer2Name = nextPlayers[1]?.name || cleanName;
              const joinedPlayer2AuthUid = nextPlayers[1]?.authUid || auth.currentUser?.uid || null;
              const nextStatus: MultiplayerRoom['status'] = 'playing';
              const hostObj = {
                id: joinedPlayer1Id,
                name: joinedPlayer1Name,
                symbol: 'X' as const,
                avatar: hostPlayer?.avatar || parsedWaiting.host?.avatar || '',
              };
              const guestObj = {
                id: joinedPlayer2Id,
                name: joinedPlayer2Name,
                symbol: 'O' as const,
                avatar: cleanAvatar,
              };
              const initialScores: Record<string, number> = {
                [joinedPlayer1Id]: 0,
                [joinedPlayer2Id]: 0,
              };
              const updatedGameState = buildInitialGameStateForGame(
                gameId,
                startId,
                parsedWaiting.gameState || {}
              );
              const unifiedForceJoin = buildUnifiedBoardAndMoveFields(updatedGameState, 'GAME_START', player.id);

              tx.update(waitingRoomRef, {
                roomId: slotRoomId,
                gameType: gameId,
                playersJson: JSON.stringify(nextPlayers),
                host: hostObj,
                guest: guestObj,
                player1: joinedPlayer1Id,
                player1Id: joinedPlayer1Id,
                player1AuthUid: joinedPlayer1AuthUid,
                player1Name: joinedPlayer1Name,
                player2: joinedPlayer2Id,
                player2Id: joinedPlayer2Id,
                player2AuthUid: joinedPlayer2AuthUid,
                player2Name: joinedPlayer2Name,
                playerCount: nextPlayers.length,
                hostId: parsedWaiting.hostId,
                isPublicMatch: true,
                scores: initialScores,
                winnerId: null,
                isDraw: false,
                status: nextStatus,
                gameStateJson: JSON.stringify(updatedGameState),
                ...unifiedForceJoin,
                moveAction: 'GAME_START',
                currentTurn: joinedPlayer1Id,
                currentTurnUserId: joinedPlayer1Id,
                lastUpdated: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });

              tx.update(slotRef, {
                status: 'matched',
                matchedRoomCode: slotRoomId,
                matchedWithId: player.id,
                updatedAt: serverTimestamp(),
              });

              return {
                matchedExisting: true,
                room: {
                  ...parsedWaiting,
                  roomCode: slotRoomId,
                  roomId: slotRoomId,
                  gameType: gameId,
                  host: hostObj,
                  guest: guestObj,
                  player1: joinedPlayer1Id,
                  player1Id: joinedPlayer1Id,
                  player1AuthUid: joinedPlayer1AuthUid,
                  player1Name: joinedPlayer1Name,
                  player2: joinedPlayer2Id,
                  player2Id: joinedPlayer2Id,
                  player2AuthUid: joinedPlayer2AuthUid,
                  player2Name: joinedPlayer2Name,
                  isPublicMatch: true,
                  scores: initialScores,
                  winnerId: null,
                  isDraw: false,
                  status: nextStatus,
                  players: nextPlayers,
                  boardState: updatedGameState,
                  gameState: updatedGameState,
                  diceRoll: unifiedForceJoin.diceRoll,
                  lastMove: unifiedForceJoin.lastMove,
                  currentTurn: joinedPlayer1Id,
                  currentTurnUserId: joinedPlayer1Id,
                } as MultiplayerRoom,
              };
            }
          }
        }

        // Only create a brand new waiting room (auto-generated Firestore ID) if zero waiting rooms exist
        const nowMs = Date.now();
        const hostAuthUid = auth.currentUser?.uid || null;
        const hostEntry: RoomPlayer = {
          id: player.id,
          ...(hostAuthUid ? { authUid: hostAuthUid } : {}),
          name: cleanName,
          avatar: cleanAvatar,
          isHost: true,
          isReady: true,
          color: 'Red',
          joinedAtMs: nowMs,
        };
        const initialPlayers = [hostEntry];
        const initialWaitBoard = buildInitialGameStateForGame(gameId, `wait_${nowMs}`);
        const unifiedWaitFields = buildUnifiedBoardAndMoveFields(initialWaitBoard, 'ROOM_CREATED', player.id, null);

        tx.set(autoRoomRef, {
          roomCode: generatedRoomId,
          roomId: generatedRoomId,
          gameId,
          gameType: gameId,
          host: {
            id: player.id,
            name: cleanName,
            symbol: 'X',
            avatar: cleanAvatar,
          },
          guest: null,
          hostId: player.id,
          player1: player.id,
          player1Id: player.id,
          player1AuthUid: hostAuthUid,
          player1Name: cleanName,
          player2: null,
          player2Id: null,
          player2AuthUid: null,
          player2Name: '',
          scores: { [player.id]: 0 },
          winnerId: null,
          isDraw: false,
          status: 'waiting',
          maxPlayers: safeMax,
          playerCount: 1,
          isPublicMatch: true,
          isOpenGroup: false,
          activeSeatLimit: safeMax,
          playersJson: JSON.stringify(initialPlayers),
          waitingPlayersJson: '[]',
          reactionsJson: '[]',
          mutedVoiceIdsJson: '[]',
          mutedChatIdsJson: '[]',
          gameStateJson: JSON.stringify(initialWaitBoard),
          ...unifiedWaitFields,
          messagesJson: '[]',
          moveAction: 'ROOM_CREATED',
          currentTurn: player.id,
          currentTurnUserId: player.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        });

        if (slotSnap.exists()) {
          tx.update(slotRef, {
            playerId: player.id,
            playerName: cleanName,
            playerAvatar: cleanAvatar,
            gameId,
            status: 'waiting',
            matchedRoomCode: generatedRoomId,
            matchedWithId: '',
            joinedAtMs: nowMs,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(slotRef, {
            id: slotId,
            playerId: player.id,
            playerName: cleanName,
            playerAvatar: cleanAvatar,
            gameId,
            status: 'waiting',
            matchedRoomCode: generatedRoomId,
            matchedWithId: '',
            joinedAtMs: nowMs,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        return {
          matchedExisting: false,
          room: {
            roomCode: generatedRoomId,
            roomId: generatedRoomId,
            gameId,
            gameType: gameId,
            hostId: player.id,
            player1: player.id,
            player1Id: player.id,
            player1AuthUid: hostAuthUid,
            player1Name: cleanName,
            player2: null,
            player2Id: null,
            player2AuthUid: null,
            player2Name: '',
            createdAt: nowMs,
            lastUpdated: nowMs,
            status: 'waiting',
            maxPlayers: safeMax,
            isPublicMatch: true,
            isOpenGroup: false,
            activeSeatLimit: safeMax,
            players: initialPlayers,
            waitingPlayers: [],
            reactions: [],
            mutedVoiceIds: [],
            mutedChatIds: [],
            boardState: initialWaitBoard,
            gameState: initialWaitBoard,
            currentTurn: player.id,
            diceRoll: null,
            lastMove: unifiedWaitFields.lastMove,
            messages: [],
            callState: null,
          } as MultiplayerRoom,
        };
      });

      if (result.matchedExisting) {
        setStoredHostedRoomCode(player.id, null);
        await leaveMatchmakingQueue(player.id).catch(() => {});
      } else {
        setStoredHostedRoomCode(player.id, result.room.roomId || result.room.roomCode);
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      if (err?.code === 'permission-denied' && attempt < 5) {
        continue;
      }
      if (err?.code === 'permission-denied') {
        handleFirestoreError(err, OperationType.WRITE, `matchmakingQueue/${slotId}`);
      }
      throw err;
    }
  }

  throw lastErr || new Error('Could not enter quick matchmaking queue. Please try again.');
}

function buildInitialGameStateForGame(
  gameId: string,
  startId: string,
  existing: Record<string, any> = {}
): Record<string, any> {
  if (gameId === 'ludo') {
    return {
      ...existing,
      tokens: [
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
      ],
      turn: 0,
      dice: 6,
      diceValue: 6,
      phase: 'roll',
      canRoll: true,
      canMove: false,
      legalTokens: [],
      consecutiveSixes: 0,
      winner: null,
      log: ['Roll 6 to bring a Red token out of the yard!'],
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'tictactoe') {
    return {
      ...existing,
      board: Array(9).fill(null),
      isXNext: true,
      scores: existing.scores || { X: 0, O: 0 },
      result: null,
      line: null,
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'chess') {
    return {
      ...existing,
      turn: 'white',
      status: 'active',
      winner: null,
      lastMove: null,
      capturedPieces: { white: [], black: [] },
      log: ['Match initialized. White to move first.'],
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'snake_ladder') {
    return {
      ...existing,
      positions: { p1: 1, p2: 1 },
      playerPositions: { p1: 1, p2: 1 },
      turn: 'p1',
      dice: 1,
      diceValue: 1,
      message: 'Player 1 (Blue 📍) turn to roll!',
      finished: false,
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'carrom') {
    return {
      ...existing,
      striker: { x: 160, angle: 0, power: 72 },
      turn: 'player',
      scores: { player: 0, opponent: 0, queenHolder: '' },
      statusLog: ['Position striker, set angle & power, or tap the board to aim!'],
      winnerMsg: null,
      finished: false,
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'quiz') {
    const seed =
      typeof existing.questionSeed === 'number' && Number.isFinite(existing.questionSeed)
        ? existing.questionSeed
        : Math.floor(100000 + Math.random() * 899999);
    return {
      ...existing,
      source: existing.source || 'curated-70-30',
      index: 0,
      currentQuestionIndex: 0,
      questionSeed: seed,
      scores: existing.scores || {},
      answersByQ: existing.answersByQ || {},
      finished: false,
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'spin_wheel') {
    return {
      ...existing,
      rotation: 0,
      spinAngle: 0,
      isSpinning: false,
      spinResult: null,
      scores: existing.scores || {},
      spinsUsedByPlayer: existing.spinsUsedByPlayer || {},
      round: 1,
      _startId: startId,
      moveSeq: 0,
    };
  }
  if (gameId === 'truth_dare') {
    return {
      ...existing,
      round: 1,
      phase: 'spinning',
      activePlayerId: '',
      selectedPlayerId: '',
      activePlayerName: '',
      choiceType: null,
      promptType: null,
      promptSource: null,
      promptText: '',
      currentPromptText: '',
      history: [],
      updatedAtMs: Date.now(),
      _startId: startId,
      moveSeq: 0,
    };
  }
  return { ...existing, _startId: startId, moveSeq: 0 };
}

export async function startFirestoreGameRoom(
  roomCode: string,
  initialGameState: Record<string, any>,
  firstTurnId: string
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const startId = `start_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    const roomRef = doc(db, 'gameRooms', cleanCode);
    const snap = await getDoc(roomRef).catch(() => null);
    const gameId = snap?.exists() ? String(snap.data().gameType || snap.data().gameId || '') : '';
    const hydratedState = buildInitialGameStateForGame(gameId, startId, initialGameState);
    const unified = buildUnifiedBoardAndMoveFields(hydratedState, 'GAME_START', firstTurnId);
    const turnId = String(firstTurnId || '').slice(0, 64);
    await updateDoc(roomRef, {
      status: 'playing',
      gameType: gameId || 'tictactoe',
      gameStateJson: JSON.stringify(hydratedState),
      ...unified,
      winnerId: null,
      isDraw: false,
      currentTurn: turnId,
      currentTurnUserId: turnId,
      moveAction: 'GAME_START',
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    throw err;
  }
}

export async function pushFirestoreGameMove(
  roomCode: string,
  moveAction: string,
  newGameState: Record<string, any>,
  nextTurnId?: string,
  status: 'playing' | 'active' | 'in_game' | 'finished' = 'playing',
  options?: {
    diceRoll?: number | null;
    summary?: string;
    scores?: Record<string, number>;
    winnerId?: string | null;
    isDraw?: boolean;
  }
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const actorId = String(newGameState?.byPlayerId || '');
  const normalizedStatus: 'playing' | 'finished' = status === 'finished' ? 'finished' : 'playing';
  const unified = buildUnifiedBoardAndMoveFields(
    newGameState,
    moveAction,
    actorId,
    options?.diceRoll,
    options?.summary
  );
  const turnId = String(nextTurnId || '').slice(0, 64);
  const resolvedScores =
    options?.scores ||
    (newGameState?.userScores && typeof newGameState.userScores === 'object'
      ? newGameState.userScores
      : undefined);
  const resolvedWinnerId =
    options?.winnerId !== undefined
      ? options.winnerId
      : typeof newGameState?.winnerId === 'string' || newGameState?.winnerId === null
      ? newGameState.winnerId
      : undefined;
  const resolvedIsDraw =
    options?.isDraw !== undefined
      ? options.isDraw
      : typeof newGameState?.isDraw === 'boolean'
      ? newGameState.isDraw
      : undefined;

  try {
    await updateDoc(doc(db, 'gameRooms', cleanCode), {
      gameStateJson: JSON.stringify(newGameState),
      ...unified,
      ...(resolvedScores ? { scores: resolvedScores } : {}),
      ...(resolvedWinnerId !== undefined ? { winnerId: resolvedWinnerId } : {}),
      ...(resolvedIsDraw !== undefined ? { isDraw: resolvedIsDraw } : {}),
      moveAction: String(moveAction).slice(0, 40),
      currentTurn: turnId,
      currentTurnUserId: turnId,
      status: normalizedStatus,
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    console.warn('Firestore pushGameMove notice:', err);
  }
}

export async function pushFirestoreQuizAnswer(
  roomCode: string,
  params: {
    actorId: string;
    questionIndex: number;
    selectedOption: number | null;
    newPlayerScore: number;
    questions: any[];
    source: 'ai' | 'curated-70-30';
    questionSeed?: number;
    moveId: string;
    moveSeq: number;
  }
): Promise<any | null> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return null;
  const roomRef = doc(db, 'gameRooms', cleanCode);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) return null;
      const parsed = parseRoomSnapshotData(snap.data());
      const existing = parsed.gameState && typeof parsed.gameState === 'object' ? parsed.gameState : {};

      const mergedScores: Record<string, number> = {
        ...(existing.scores && typeof existing.scores === 'object' ? existing.scores : {}),
        [params.actorId]: params.newPlayerScore,
      };
      const existingAnswersByQ: Record<number, Record<string, number | null>> =
        existing.answersByQ && typeof existing.answersByQ === 'object' ? { ...existing.answersByQ } : {};
      const currentQAnswers: Record<string, number | null> = {
        ...(existingAnswersByQ[params.questionIndex] || {}),
        [params.actorId]: params.selectedOption,
      };
      existingAnswersByQ[params.questionIndex] = currentQAnswers;

      const activeParticipants = parsed.players.map((p) => p.id);
      const allAnswered =
        activeParticipants.length <= 1 ||
        activeParticipants.every((pid) => currentQAnswers[pid] !== undefined);

      const qList =
        Array.isArray(existing.questions) && existing.questions.length > 0
          ? existing.questions
          : params.questions;
      const currentIndex =
        typeof existing.index === 'number' && existing.index > params.questionIndex
          ? existing.index
          : params.questionIndex;
      const isLastQ = currentIndex >= qList.length - 1;
      const nextIndex = allAnswered && !isLastQ && currentIndex === params.questionIndex ? currentIndex + 1 : currentIndex;
      const nextFinished = Boolean(existing.finished) || (allAnswered && isLastQ && currentIndex === params.questionIndex);
      const status: 'playing' | 'finished' = nextFinished ? 'finished' : 'playing';
      const resolvedSeed =
        typeof existing.questionSeed === 'number'
          ? existing.questionSeed
          : typeof params.questionSeed === 'number'
          ? params.questionSeed
          : undefined;

      const nextState = {
        questions: qList,
        source: existing.source || params.source,
        index: nextIndex,
        currentQuestionIndex: nextIndex,
        ...(resolvedSeed !== undefined ? { questionSeed: resolvedSeed } : {}),
        scores: mergedScores,
        answersByQ: existingAnswersByQ,
        finished: nextFinished,
        moveId: params.moveId,
        moveSeq: Math.max(Number(existing.moveSeq || 0) + 1, params.moveSeq),
        byPlayerId: params.actorId,
      };
      const unified = buildUnifiedBoardAndMoveFields(nextState, 'QUIZ_MOVE', params.actorId, null);

      tx.update(roomRef, {
        gameStateJson: JSON.stringify(nextState),
        ...unified,
        scores: mergedScores,
        moveAction: 'QUIZ_MOVE',
        currentTurn: '',
        currentTurnUserId: '',
        status,
        lastUpdated: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return nextState;
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    console.warn('Firestore pushQuizAnswer notice:', err);
    return null;
  }
}

export async function rematchFirestoreGameRoom(
  roomCode: string,
  resetState: Record<string, any>,
  firstTurnId: string
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const moveId = `rematch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const stampedReset = { ...resetState, moveId, moveSeq: 0, winnerId: null, isDraw: false };
  const unified = buildUnifiedBoardAndMoveFields(stampedReset, 'REMATCH', firstTurnId);
  const turnId = String(firstTurnId || '').slice(0, 64);
  try {
    await updateDoc(doc(db, 'gameRooms', cleanCode), {
      status: 'playing',
      gameStateJson: JSON.stringify(stampedReset),
      ...unified,
      winnerId: null,
      isDraw: false,
      moveAction: 'REMATCH',
      currentTurn: turnId,
      currentTurnUserId: turnId,
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    console.warn('Firestore rematchGameRoom notice:', err);
  }
}

export async function sendFirestoreRoomChat(
  roomCode: string,
  msg: Omit<InGameChatMessage, 'id' | 'roomCode' | 'timestamp'>
): Promise<{ sent: boolean; restricted?: boolean }> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return { sent: false };
  const roomRef = doc(db, 'gameRooms', cleanCode);
  try {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return { sent: false };
    const parsed = parseRoomSnapshotData(snap.data());
    if ((parsed.mutedChatIds || []).includes(msg.senderId)) {
      return { sent: false, restricted: true };
    }
    const nowMs = Date.now();
    const formatted: InGameChatMessage = {
      id: `gmsg_${nowMs}_${Math.random().toString(36).substring(2, 6)}`,
      roomCode: cleanCode,
      senderId: msg.senderId,
      senderName: msg.senderName,
      senderAvatar: sanitizeAvatarUrl(msg.senderAvatar),
      ...(msg.text ? { text: msg.text.slice(0, 1000) } : {}),
      ...(msg.imageUrl ? { imageUrl: msg.imageUrl } : {}),
      timestamp: new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: nowMs,
    };
    const nextMessages = [...parsed.messages, formatted]
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(-50);
    await updateDoc(roomRef, {
      messagesJson: JSON.stringify(nextMessages),
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { sent: true };
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    console.warn('Firestore room chat notice:', err);
    return { sent: false };
  }
}

export async function sendFirestoreRoomReaction(
  roomCode: string,
  reaction: Omit<RoomReaction, 'id' | 'createdAtMs'>
): Promise<RoomReaction | null> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return null;
  const roomRef = doc(db, 'gameRooms', cleanCode);
  try {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return null;
    const parsed = parseRoomSnapshotData(snap.data());
    const item: RoomReaction = {
      id: `rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      emoji: String(reaction.emoji || '🔥').slice(0, 16),
      senderId: reaction.senderId,
      senderName: reaction.senderName.slice(0, 60),
      createdAtMs: Date.now(),
    };
    const nextReactions = [...(parsed.reactions || []), item].slice(-25);
    await updateDoc(roomRef, {
      reactionsJson: JSON.stringify(nextReactions),
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return item;
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    return null;
  }
}

export async function hostUpdateRoomModeration(
  roomCode: string,
  hostId: string,
  updates: { mutedVoiceIds?: string[]; mutedChatIds?: string[] }
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const roomRef = doc(db, 'gameRooms', cleanCode);
  try {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return;
    const parsed = parseRoomSnapshotData(snap.data());
    if (parsed.hostId !== hostId) return;
    await updateDoc(roomRef, {
      mutedVoiceIdsJson: JSON.stringify(
        updates.mutedVoiceIds !== undefined ? updates.mutedVoiceIds : parsed.mutedVoiceIds || []
      ),
      mutedChatIdsJson: JSON.stringify(
        updates.mutedChatIds !== undefined ? updates.mutedChatIds : parsed.mutedChatIds || []
      ),
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
  }
}

export async function hostRotateRoomPlayers(
  roomCode: string,
  hostId: string,
  nextActiveIds: string[],
  resetState?: Record<string, any>
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const roomRef = doc(db, 'gameRooms', cleanCode);
  try {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return;
    const parsed = parseRoomSnapshotData(snap.data());
    if (parsed.hostId !== hostId) return;

    const seatColors = ['Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'];
    const allParticipants = [...parsed.players, ...(parsed.waitingPlayers || [])];
    const byId = new Map<string, RoomPlayer>();
    allParticipants.forEach((p) => {
      if (!byId.has(p.id)) byId.set(p.id, p);
    });

    const chosenSet = new Set(nextActiveIds.filter((id) => byId.has(id)));
    if (chosenSet.size === 0 && parsed.players[0]) {
      chosenSet.add(parsed.players[0].id);
    }

    const nextActive: RoomPlayer[] = Array.from(chosenSet).map((id, idx) => {
      const p = byId.get(id)!;
      return {
        ...p,
        isHost: p.id === parsed.hostId,
        color: seatColors[idx % seatColors.length],
      };
    });
    const nextWaiting: RoomPlayer[] = allParticipants
      .filter((p) => !chosenSet.has(p.id))
      .map((p) => ({ ...p, isHost: p.id === parsed.hostId }));

    const moveId = `rotate_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nextTurnId = String(nextActive[0]?.id || parsed.hostId).slice(0, 64);
    const stampedRotate = { ...(resetState || {}), moveId, moveSeq: 0 };
    const unifiedRotate = buildUnifiedBoardAndMoveFields(stampedRotate, 'REMATCH', hostId);
    await updateDoc(roomRef, {
      playersJson: JSON.stringify(nextActive),
      waitingPlayersJson: JSON.stringify(nextWaiting),
      host: nextActive[0]
        ? {
            id: nextActive[0].id,
            name: nextActive[0].name,
            symbol: 'X',
            avatar: nextActive[0].avatar || '',
          }
        : parsed.host || null,
      guest: nextActive[1]
        ? {
            id: nextActive[1].id,
            name: nextActive[1].name,
            symbol: 'O',
            avatar: nextActive[1].avatar || '',
          }
        : null,
      player1: nextActive[0]?.id || parsed.hostId,
      player1Id: nextActive[0]?.id || parsed.hostId,
      player1AuthUid: nextActive[0]?.authUid || null,
      player1Name: nextActive[0]?.name || '',
      player2: nextActive[1]?.id || null,
      player2Id: nextActive[1]?.id || null,
      player2AuthUid: nextActive[1]?.authUid || null,
      player2Name: nextActive[1]?.name || '',
      playerCount: Math.min(500, nextActive.length + nextWaiting.length),
      hostId: parsed.hostId,
      winnerId: null,
      isDraw: false,
      status: 'playing',
      gameStateJson: JSON.stringify(stampedRotate),
      ...unifiedRotate,
      moveAction: 'REMATCH',
      currentTurn: nextTurnId,
      currentTurnUserId: nextTurnId,
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
  }
}

export async function kickOrLeaveFirestoreRoom(
  roomCode: string,
  targetPlayerId: string
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  if (getStoredHostedRoomCode(targetPlayerId) === cleanCode) {
    setStoredHostedRoomCode(targetPlayerId, null);
  }
  const roomRef = doc(db, 'gameRooms', cleanCode);
  try {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) return;
    const parsed = parseRoomSnapshotData(snap.data());
    let remainingActive = parsed.players.filter((p) => p.id !== targetPlayerId);
    const remainingWaiting = (parsed.waitingPlayers || []).filter((p) => p.id !== targetPlayerId);

    const totalLeft = remainingActive.length + remainingWaiting.length;
    if (totalLeft === 0) {
      await deleteDoc(roomRef);
      return;
    }

    // Auto-promote the first Waiting Seat player if an active seat opened up
    const seatLimit = parsed.isOpenGroup
      ? Math.max(2, parsed.activeSeatLimit || 2)
      : parsed.maxPlayers;
    while (remainingActive.length < seatLimit && remainingWaiting.length > 0) {
      const promoted = remainingWaiting.shift();
      if (promoted) remainingActive.push(promoted);
    }

    const nextHostId =
      parsed.hostId === targetPlayerId
        ? remainingActive[0]?.id || remainingWaiting[0]?.id || ''
        : parsed.hostId;
    const updatedActive = remainingActive.map((p) => ({
      ...p,
      isHost: p.id === nextHostId,
    }));
    const updatedWaiting = remainingWaiting.map((p) => ({
      ...p,
      isHost: p.id === nextHostId,
    }));

    const nextStatusAfterLeave =
      updatedActive.length < 2 &&
      !parsed.isOpenGroup &&
      (parsed.status === 'active' || parsed.status === 'playing' || parsed.status === 'in_game')
        ? 'waiting'
        : parsed.status;
    await updateDoc(roomRef, {
      playersJson: JSON.stringify(updatedActive),
      waitingPlayersJson: JSON.stringify(updatedWaiting),
      host: updatedActive[0]
        ? {
            id: updatedActive[0].id,
            name: updatedActive[0].name,
            symbol: 'X',
            avatar: updatedActive[0].avatar || '',
          }
        : null,
      guest: updatedActive[1]
        ? {
            id: updatedActive[1].id,
            name: updatedActive[1].name,
            symbol: 'O',
            avatar: updatedActive[1].avatar || '',
          }
        : null,
      player1: updatedActive[0]?.id || nextHostId,
      player1Id: updatedActive[0]?.id || nextHostId,
      player1AuthUid: updatedActive[0]?.authUid || null,
      player1Name: updatedActive[0]?.name || '',
      player2: updatedActive[1]?.id || null,
      player2Id: updatedActive[1]?.id || null,
      player2AuthUid: updatedActive[1]?.authUid || null,
      player2Name: updatedActive[1]?.name || '',
      playerCount: Math.min(500, updatedActive.length + updatedWaiting.length),
      hostId: nextHostId,
      currentTurn: nextHostId,
      currentTurnUserId: nextHostId,
      status: nextStatusAfterLeave,
      lastUpdated: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${cleanCode}`);
    }
    console.warn('Firestore leave/kick notice:', err);
  }
}

export function subscribeToGameRoom(
  roomCode: string,
  onRoomUpdate: (room: MultiplayerRoom, moveAction: string) => void,
  onRoomDeleted?: () => void
): Unsubscribe {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) {
    return () => {};
  }
  return onSnapshot(
    doc(db, 'gameRooms', cleanCode),
    (snap) => {
      if (!snap.exists()) {
        onRoomDeleted?.();
        return;
      }
      const data = snap.data();
      const room = parseRoomSnapshotData(data);
      onRoomUpdate(room, String(data.moveAction || ''));
    },
    (err) => {
      console.warn('Game room onSnapshot error:', err);
    }
  );
}

// ============================================================================
// REAL-TIME WEBRTC IN-GAME VOICE CHAT SIGNALING (FIRESTORE)
// ============================================================================

export interface FirestoreVoicePeer {
  peerId: string;
  name: string;
  avatar: string;
  micEnabled: boolean;
}

export interface FirestoreVoiceSignal {
  id: string;
  fromId: string;
  toId: string;
  signalType: 'offer' | 'answer' | 'candidate' | 'hangup';
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

function sanitizeVoiceId(raw: string): string {
  const cleaned = (raw || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72);
  return cleaned.length >= 3 ? cleaned : `peer_${cleaned || '000'}`;
}

export async function upsertFirestoreVoicePeer(
  roomCode: string,
  peer: FirestoreVoicePeer
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const peerId = sanitizeVoiceId(peer.peerId);
  const peerRef = doc(db, 'gameRooms', cleanCode, 'voice_peers', peerId);
  const safeName = (peer.name || 'Player').trim().slice(0, 80) || 'Player';
  const safeAvatar =
    typeof peer.avatar === 'string' && peer.avatar.length <= 400000 ? peer.avatar : '';

  try {
    const snap = await getDoc(peerRef);
    if (snap.exists()) {
      await updateDoc(peerRef, {
        name: safeName,
        ...(safeAvatar ? { avatar: safeAvatar } : {}),
        micEnabled: Boolean(peer.micEnabled),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(peerRef, {
        peerId,
        name: safeName,
        ...(safeAvatar ? { avatar: safeAvatar } : {}),
        micEnabled: Boolean(peer.micEnabled),
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `gameRooms/${cleanCode}/voice_peers/${peerId}`);
    }
    console.warn('Firestore voice peer upsert notice:', err);
  }
}

export async function removeFirestoreVoicePeer(
  roomCode: string,
  rawPeerId: string
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const peerId = sanitizeVoiceId(rawPeerId);
  try {
    await deleteDoc(doc(db, 'gameRooms', cleanCode, 'voice_peers', peerId));
  } catch (err) {
    console.warn('Firestore voice peer cleanup notice:', err);
  }
}

export function subscribeToFirestoreVoicePeers(
  roomCode: string,
  onPeers: (peers: FirestoreVoicePeer[]) => void
): Unsubscribe {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return () => {};
  const q = query(
    collection(db, 'gameRooms', cleanCode, 'voice_peers'),
    where('micEnabled', 'in', [true, false])
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const peers: FirestoreVoicePeer[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        peers.push({
          peerId: String(data.peerId || d.id),
          name: String(data.name || 'Player'),
          avatar: String(data.avatar || ''),
          micEnabled: Boolean(data.micEnabled),
        });
      });
      onPeers(peers);
    },
    (err) => {
      console.warn('Firestore voice peers onSnapshot notice:', err);
    }
  );
}

export async function sendFirestoreVoiceSignal(
  roomCode: string,
  signal: Omit<FirestoreVoiceSignal, 'id'>
): Promise<void> {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return;
  const signalId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload: Record<string, any> = {
    id: signalId,
    fromId: sanitizeVoiceId(signal.fromId),
    toId: sanitizeVoiceId(signal.toId),
    signalType: signal.signalType,
    createdAt: serverTimestamp(),
  };
  if (typeof signal.sdp === 'string' && signal.sdp.length > 0 && signal.sdp.length <= 20000) {
    payload.sdp = signal.sdp;
  }
  if (
    typeof signal.candidate === 'string' &&
    signal.candidate.length > 0 &&
    signal.candidate.length <= 2000
  ) {
    payload.candidate = signal.candidate;
  }
  if (typeof signal.sdpMid === 'string' && signal.sdpMid.length > 0 && signal.sdpMid.length <= 64) {
    payload.sdpMid = signal.sdpMid;
  }
  if (
    typeof signal.sdpMLineIndex === 'number' &&
    Number.isInteger(signal.sdpMLineIndex) &&
    signal.sdpMLineIndex >= 0 &&
    signal.sdpMLineIndex <= 16
  ) {
    payload.sdpMLineIndex = signal.sdpMLineIndex;
  }

  try {
    await setDoc(doc(db, 'gameRooms', cleanCode, 'voice_signals', signalId), payload);
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `gameRooms/${cleanCode}/voice_signals/${signalId}`
      );
    }
    console.warn('Firestore voice signal notice:', err);
  }
}

export function subscribeToFirestoreVoiceSignals(
  roomCode: string,
  myPeerId: string,
  onSignal: (signal: FirestoreVoiceSignal) => void
): Unsubscribe {
  const cleanCode = normalizeRoomId(roomCode);
  if (!cleanCode) return () => {};
  const targetId = sanitizeVoiceId(myPeerId);
  const q = query(
    collection(db, 'gameRooms', cleanCode, 'voice_signals'),
    where('toId', '==', targetId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          onSignal({
            id: String(data.id || change.doc.id),
            fromId: String(data.fromId || ''),
            toId: String(data.toId || ''),
            signalType: data.signalType as FirestoreVoiceSignal['signalType'],
            sdp: typeof data.sdp === 'string' ? data.sdp : undefined,
            candidate: typeof data.candidate === 'string' ? data.candidate : undefined,
            sdpMid: typeof data.sdpMid === 'string' ? data.sdpMid : undefined,
            sdpMLineIndex: typeof data.sdpMLineIndex === 'number' ? data.sdpMLineIndex : undefined,
          });
          deleteDoc(change.doc.ref).catch(() => {});
        }
      });
    },
    (err) => {
      console.warn('Firestore voice signals onSnapshot notice:', err);
    }
  );
}

// ============================================================================
// REAL-TIME FRIEND REQUESTS & NOTIFICATIONS (FIRESTORE)
// ============================================================================

export function buildFriendRequestId(fromUserId: string, toUserId: string): string {
  const cleanFrom = (fromUserId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const cleanTo = (toUserId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `${cleanFrom}__${cleanTo}`.slice(0, 140);
}

export async function sendFirestoreFriendRequest(
  fromUser: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl'>,
  toUser: { id: string; fullName?: string; avatarUrl?: string }
): Promise<void> {
  if (!fromUser?.id || !toUser?.id || fromUser.id === toUser.id) return;

  // Verify recipient profile exists in Firestore (auto-seed if missing in profiles collection? Rules require existsAfter profiles/toUserId)
  let resolvedToName = (toUser.fullName || 'JIT Member').trim().slice(0, 120) || 'JIT Member';
  let resolvedToAvatar = sanitizeAvatarUrl(toUser.avatarUrl);
  try {
    const toSnap = await getDocFromServer(doc(db, 'profiles', toUser.id)).catch(() =>
      getDoc(doc(db, 'profiles', toUser.id))
    );
    if (!toSnap.exists()) {
      // Cannot create Firestore friendRequest if recipient profile doc doesn't exist yet
      console.info('Recipient profile not yet in Firestore profiles collection:', toUser.id);
      return;
    }
    const pData = toSnap.data();
    if (pData?.fullName) resolvedToName = String(pData.fullName).slice(0, 120);
    if (pData?.avatarUrl) resolvedToAvatar = sanitizeAvatarUrl(String(pData.avatarUrl));
  } catch {
    return;
  }

  const requestId = buildFriendRequestId(fromUser.id, toUser.id);
  const reqRef = doc(db, 'friendRequests', requestId);
  const fromName = (fromUser.fullName || 'JIT Member').trim().slice(0, 120) || 'JIT Member';
  const fromAvatar = sanitizeAvatarUrl(fromUser.avatarUrl);
  const nowIso = new Date().toISOString();
  const notifId = `notif_fr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);

  try {
    const existing = await getDoc(reqRef).catch(() => null);
    const batch = writeBatch(db);
    if (existing && existing.exists()) {
      batch.update(reqRef, {
        status: 'pending',
        fromUserName: fromName,
        fromUserAvatar: fromAvatar,
        toUserName: resolvedToName,
        toUserAvatar: resolvedToAvatar,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(reqRef, {
        id: requestId,
        fromUserId: fromUser.id,
        fromUserName: fromName,
        fromUserAvatar: fromAvatar,
        toUserId: toUser.id,
        toUserName: resolvedToName,
        toUserAvatar: resolvedToAvatar,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: toUser.id,
      fromUserId: fromUser.id,
      fromUserName: fromName,
      fromUserAvatar: fromAvatar,
      type: 'friend_request',
      title: 'New Friend Request',
      message: `${fromName} sent you a friend request`,
      isRead: false,
      createdAtIso: nowIso,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `friendRequests/${requestId}`);
    }
    throw err;
  }
}

export async function respondToFirestoreFriendRequest(
  fromUserId: string,
  currentUser: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl'>,
  action: 'accepted' | 'declined'
): Promise<void> {
  if (!fromUserId || !currentUser?.id) return;
  const requestId = buildFriendRequestId(fromUserId, currentUser.id);
  const reqRef = doc(db, 'friendRequests', requestId);

  try {
    const snap = await getDoc(reqRef);
    if (!snap.exists()) return;
    const batch = writeBatch(db);
    batch.update(reqRef, {
      status: action,
      updatedAt: serverTimestamp(),
    });

    if (action === 'accepted') {
      const myName = (currentUser.fullName || 'JIT Member').trim().slice(0, 120) || 'JIT Member';
      const notifId = `notif_fa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: fromUserId,
        fromUserId: currentUser.id,
        fromUserName: myName,
        fromUserAvatar: sanitizeAvatarUrl(currentUser.avatarUrl),
        type: 'friend_accept',
        title: 'Friend Request Accepted',
        message: `${myName} accepted your friend request!`,
        isRead: false,
        createdAtIso: new Date().toISOString(),
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `friendRequests/${requestId}`);
    }
    console.warn('Firestore respondToFriendRequest notice:', err);
  }
}

export async function removeFirestoreFriendship(
  myUserId: string,
  friendUserId: string
): Promise<void> {
  if (!myUserId || !friendUserId) return;
  const canonicalId = buildFriendRequestId(myUserId, friendUserId);
  try {
    const reqRef = doc(db, 'friendRequests', canonicalId);
    const snap = await getDoc(reqRef);
    if (snap.exists()) {
      await deleteDoc(reqRef);
    }
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.DELETE, `friendRequests/${canonicalId}`);
    }
  }
}

export function subscribeToFirestoreFriendRequests(
  userId: string,
  onUpdate: (state: {
    incomingPendingIds: string[];
    outgoingPendingIds: string[];
    acceptedFriendIds: string[];
    requests: FriendRequest[];
  }) => void
): Unsubscribe {
  if (!userId) return () => {};
  const incomingDocs = new Map<string, FriendRequest>();
  const outgoingDocs = new Map<string, FriendRequest>();

  const emit = () => {
    const incomingPendingIds: string[] = [];
    const outgoingPendingIds: string[] = [];
    const acceptedSet = new Set<string>();
    const allRequests: FriendRequest[] = [];

    incomingDocs.forEach((req) => {
      allRequests.push(req);
      if (req.status === 'pending') incomingPendingIds.push(req.fromUserId);
      if (req.status === 'accepted') acceptedSet.add(req.fromUserId);
    });
    outgoingDocs.forEach((req) => {
      allRequests.push(req);
      if (req.status === 'pending') outgoingPendingIds.push(req.toUserId);
      if (req.status === 'accepted') acceptedSet.add(req.toUserId);
    });

    onUpdate({
      incomingPendingIds: Array.from(new Set(incomingPendingIds)),
      outgoingPendingIds: Array.from(new Set(outgoingPendingIds)),
      acceptedFriendIds: Array.from(acceptedSet),
      requests: allRequests,
    });
  };

  const toFriendReq = (id: string, data: Record<string, any>): FriendRequest => ({
    id,
    fromUserId: String(data.fromUserId || ''),
    fromUserName: String(data.fromUserName || 'JIT Member'),
    fromUserAvatar: typeof data.fromUserAvatar === 'string' ? data.fromUserAvatar : undefined,
    toUserId: String(data.toUserId || ''),
    toUserName: String(data.toUserName || 'JIT Member'),
    toUserAvatar: typeof data.toUserAvatar === 'string' ? data.toUserAvatar : undefined,
    status: (data.status as FriendRequest['status']) || 'pending',
    createdAtIso:
      data.createdAt && typeof data.createdAt.toDate === 'function'
        ? data.createdAt.toDate().toISOString()
        : undefined,
  });

  const qIn = query(collection(db, 'friendRequests'), where('toUserId', '==', userId));
  const qOut = query(collection(db, 'friendRequests'), where('fromUserId', '==', userId));

  const unsubIn = onSnapshot(
    qIn,
    (snap) => {
      incomingDocs.clear();
      snap.forEach((d) => {
        incomingDocs.set(d.id, toFriendReq(d.id, d.data()));
      });
      emit();
    },
    (err) => {
      console.warn('friendRequests incoming onSnapshot notice:', err);
    }
  );

  const unsubOut = onSnapshot(
    qOut,
    (snap) => {
      outgoingDocs.clear();
      snap.forEach((d) => {
        outgoingDocs.set(d.id, toFriendReq(d.id, d.data()));
      });
      emit();
    },
    (err) => {
      console.warn('friendRequests outgoing onSnapshot notice:', err);
    }
  );

  return () => {
    unsubIn();
    unsubOut();
  };
}

export function subscribeToFirestoreNotifications(
  userId: string,
  onNotifications: (items: InAppNotification[]) => void
): Unsubscribe {
  if (!userId) return () => {};
  const q = query(collection(db, 'notifications'), where('userId', '==', userId), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const items: InAppNotification[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const ms = Number(data.createdAtMs || 0);
        const iso = String(data.createdAtIso || '');
        items.push({
          id: String(data.id || d.id),
          userId: String(data.userId || userId),
          fromUserId: typeof data.fromUserId === 'string' ? data.fromUserId : undefined,
          fromUserName: typeof data.fromUserName === 'string' ? data.fromUserName : undefined,
          fromUserAvatar: typeof data.fromUserAvatar === 'string' ? data.fromUserAvatar : undefined,
          type: (data.type as InAppNotification['type']) || 'friend_request',
          title: String(data.title || 'Notification'),
          message: String(data.message || ''),
          createdAt: iso
            ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Just now',
          createdAtIso: iso,
          createdAtMs: ms,
          isRead: Boolean(data.isRead),
          ...(typeof data.roomId === 'string' ? { roomId: data.roomId } : {}),
          ...(typeof data.gameId === 'string' ? { gameId: data.gameId } : {}),
          ...(typeof data.gameName === 'string' ? { gameName: data.gameName } : {}),
        });
      });
      items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      onNotifications(items);
    },
    (err) => {
      console.warn('notifications onSnapshot notice:', err);
    }
  );
}

export async function markFirestoreNotificationRead(notificationId: string): Promise<void> {
  if (!notificationId) return;
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      isRead: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('markFirestoreNotificationRead notice:', err);
  }
}

export async function markAllFirestoreNotificationsRead(notificationIds: string[]): Promise<void> {
  if (!notificationIds.length) return;
  try {
    const batch = writeBatch(db);
    notificationIds.slice(0, 40).forEach((id) => {
      batch.update(doc(db, 'notifications', id), {
        isRead: true,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (err) {
    console.warn('markAllFirestoreNotificationsRead notice:', err);
  }
}

// ============================================================================
// PERSONAL MESSAGING (DMs) & GROUP CONVERSATIONS (FIRESTORE)
// ============================================================================

export function buildCanonicalChatId(
  userA: { id?: string; phone?: string; contactNumber?: string } | string,
  userB: { id?: string; phone?: string; contactNumber?: string } | string
): string {
  const rawA =
    typeof userA === 'string'
      ? userA.trim()
      : String(userA?.id || userA?.phone || userA?.contactNumber || '').trim();
  const rawB =
    typeof userB === 'string'
      ? userB.trim()
      : String(userB?.id || userB?.phone || userB?.contactNumber || '').trim();
  const cleanA = rawA.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const cleanB = rawB.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const sorted = [cleanA, cleanB].sort();
  return `${sorted[0]}_${sorted[1]}`.slice(0, 140);
}

export function buildDirectConversationId(uidA: string, uidB: string): string {
  return buildCanonicalChatId(uidA, uidB);
}

function parseParticipantsMap(jsonStr?: string): Record<string, { name: string; avatar?: string }> {
  try {
    const parsed = JSON.parse(jsonStr || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function ensureFirestoreDirectConversation(
  me: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl' | 'contactNumber'> & { phone?: string },
  partner: { id: string; fullName?: string; avatarUrl?: string; contactNumber?: string; phone?: string }
): Promise<Conversation> {
  const myKey = String(me.id || me.phone || me.contactNumber || '').trim();
  const partnerKey = String(partner.id || partner.phone || partner.contactNumber || '').trim();
  const chatId = buildCanonicalChatId(myKey, partnerKey);
  const chatRef = doc(db, 'chats', chatId);

  let partnerName = (partner.fullName || '').trim();
  let partnerAvatar = partner.avatarUrl || '';
  if (!partnerName || !partnerAvatar) {
    try {
      const snap = await getDoc(doc(db, 'profiles', partner.id));
      if (snap.exists()) {
        const d = snap.data();
        if (!partnerName && d?.fullName) partnerName = String(d.fullName);
        if (!partnerAvatar && d?.avatarUrl) partnerAvatar = String(d.avatarUrl);
      }
    } catch {
      // Fallback gracefully
    }
  }
  partnerName = (partnerName || 'JIT Member').slice(0, 120);
  partnerAvatar = sanitizeAvatarUrl(partnerAvatar);

  const participantsMap: Record<string, { name: string; avatar?: string }> = {
    [me.id]: {
      name: (me.fullName || 'JIT Member').slice(0, 120),
      avatar: sanitizeAvatarUrl(me.avatarUrl),
    },
    [partner.id]: {
      name: partnerName,
      avatar: partnerAvatar,
    },
  };
  const sortedParticipants = Array.from(new Set([me.id, partner.id].filter(Boolean))).sort();

  try {
    const existing = await getDocFromServer(chatRef).catch(() => getDoc(chatRef));
    if (existing.exists()) {
      const data = existing.data();
      const map = { ...parseParticipantsMap(data.participantsJson), ...participantsMap };
      const resolvedUpdatedMs =
        data.updatedAt && typeof data.updatedAt.toMillis === 'function'
          ? data.updatedAt.toMillis()
          : Number(data.updatedAtMs || Date.now());
      const resolvedUpdatedLabel =
        data.updatedAt && typeof data.updatedAt.toDate === 'function'
          ? data.updatedAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : String(data.lastMessageAt || 'Just now');
      const lastText = String(data.lastMessage ?? data.lastMessageText ?? '');

      return {
        id: chatId,
        type: 'direct',
        name: partnerName,
        avatarUrl: partnerAvatar,
        participantIds: Array.isArray(data.participants)
          ? data.participants
          : Array.isArray(data.participantIds)
          ? data.participantIds
          : sortedParticipants,
        participantsMap: map,
        lastMessage: lastText
          ? {
              text: lastText,
              senderId: String(data.lastMessageSenderId || ''),
              createdAt: resolvedUpdatedLabel,
              isRead: true,
            }
          : undefined,
        unreadCount: 0,
        updatedAt: resolvedUpdatedLabel,
        updatedAtMs: resolvedUpdatedMs,
      };
    }

    const nowMs = Date.now();
    await setDoc(chatRef, {
      id: chatId,
      type: 'direct',
      name: partnerName,
      avatarUrl: partnerAvatar,
      participants: sortedParticipants,
      participantIds: sortedParticipants,
      participantsJson: JSON.stringify(participantsMap).slice(0, 29500),
      lastMessage: '',
      lastMessageText: '',
      lastMessageSenderId: '',
      lastMessageAt: 'Just now',
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `chats/${chatId}`);
    }
    throw err;
  }

  return {
    id: chatId,
    type: 'direct',
    name: partnerName,
    avatarUrl: partnerAvatar,
    participantIds: sortedParticipants,
    participantsMap,
    unreadCount: 0,
    updatedAt: 'Just now',
    updatedAtMs: Date.now(),
  };
}

export async function createFirestoreGroupConversation(
  creator: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl'>,
  name: string,
  memberIds: string[],
  participantsMap: Record<string, { name: string; avatar?: string }>
): Promise<Conversation> {
  const chatId = `chat_grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 120);
  const cleanName = name.trim().slice(0, 120) || 'JIT Group Chat';
  const participantIds = Array.from(new Set([creator.id, ...memberIds])).slice(0, 50);
  const nowMs = Date.now();

  try {
    await setDoc(doc(db, 'chats', chatId), {
      id: chatId,
      type: 'group',
      name: cleanName,
      avatarUrl: '/assets/aistudio/image_e64e54f2.png',
      participants: participantIds,
      participantIds,
      participantsJson: JSON.stringify(participantsMap).slice(0, 29500),
      lastMessage: 'Group created. Welcome!',
      lastMessageText: 'Group created. Welcome!',
      lastMessageSenderId: creator.id,
      lastMessageAt: 'Just now',
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}`);
    }
    throw err;
  }

  return {
    id: chatId,
    type: 'group',
    name: cleanName,
    avatarUrl: '/assets/aistudio/image_e64e54f2.png',
    participantIds,
    participantsMap,
    lastMessage: {
      text: 'Group created. Welcome!',
      senderId: creator.id,
      createdAt: 'Just now',
      isRead: true,
    },
    unreadCount: 0,
    updatedAt: 'Just now',
    updatedAtMs: nowMs,
  };
}

function sanitizeTypingUsersMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [uid, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof uid === 'string' && uid.trim() && typeof val === 'number' && Number.isFinite(val) && val > 0) {
      result[uid] = val;
    }
  }
  return result;
}

function mapChatDocToConversation(
  docId: string,
  data: Record<string, any>,
  currentUserId: string
): Conversation {
  const participantIds: string[] = Array.isArray(data.participants)
    ? data.participants
    : Array.isArray(data.participantIds)
    ? data.participantIds
    : [];
  const pMap = parseParticipantsMap(data.participantsJson);
  const type = data.type === 'group' ? 'group' : 'direct';
  const peerId = type === 'direct' ? participantIds.find((pid) => pid !== currentUserId) : undefined;
  const peerInfo = peerId ? pMap[peerId] : undefined;

  const serverUpdatedMs =
    data.updatedAt && typeof data.updatedAt.toMillis === 'function'
      ? data.updatedAt.toMillis()
      : Number(data.updatedAtMs || 0);
  const serverUpdatedLabel =
    data.updatedAt && typeof data.updatedAt.toDate === 'function'
      ? data.updatedAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : String(data.lastMessageAt || 'Just now');
  const lastText = String(data.lastMessage ?? data.lastMessageText ?? '');

  return {
    id: String(data.id || docId),
    type,
    name: peerInfo?.name || String(data.name || 'JIT Member'),
    avatarUrl: peerInfo?.avatar || (typeof data.avatarUrl === 'string' ? data.avatarUrl : undefined),
    participantIds,
    participantsMap: pMap,
    typingUsers: sanitizeTypingUsersMap(data.typingUsers),
    lastMessage: lastText
      ? {
          text: lastText,
          senderId: String(data.lastMessageSenderId || ''),
          createdAt: serverUpdatedLabel,
          isRead: true,
        }
      : undefined,
    unreadCount: 0,
    updatedAt: serverUpdatedLabel,
    updatedAtMs: serverUpdatedMs,
  };
}

export function subscribeToFirestoreConversations(
  userId: string,
  onConversations: (convs: Conversation[]) => void
): Unsubscribe {
  if (!userId) return () => {};

  let chatsList: Conversation[] = [];
  let legacyList: Conversation[] = [];

  const emitMerged = () => {
    const byId = new Map<string, Conversation>();
    const directPeerToChat = new Map<string, Conversation>();

    for (const c of chatsList) {
      byId.set(c.id, c);
      if (c.type === 'direct') {
        const peerId = c.participantIds.find((pid) => pid !== userId);
        if (peerId) directPeerToChat.set(peerId, c);
      }
    }

    for (const lc of legacyList) {
      if (lc.type === 'direct') {
        const peerId = lc.participantIds.find((pid) => pid !== userId);
        if (peerId && directPeerToChat.has(peerId)) {
          continue;
        }
      }
      if (!byId.has(lc.id)) {
        byId.set(lc.id, lc);
      }
    }

    const merged = Array.from(byId.values()).sort(
      (a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
    );
    onConversations(merged);
  };

  const qChats = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', userId),
    limit(60)
  );
  const qLegacy = query(
    collection(db, 'conversations'),
    where('participantIds', 'array-contains', userId),
    limit(60)
  );

  const unsubChats = onSnapshot(
    qChats,
    (snap) => {
      const next: Conversation[] = [];
      snap.forEach((d) => {
        next.push(mapChatDocToConversation(d.id, d.data(), userId));
      });
      chatsList = next;
      emitMerged();
    },
    (err) => {
      console.warn('chats onSnapshot notice:', err);
    }
  );

  const unsubLegacy = onSnapshot(
    qLegacy,
    (snap) => {
      const next: Conversation[] = [];
      snap.forEach((d) => {
        next.push(mapChatDocToConversation(d.id, d.data(), userId));
      });
      legacyList = next;
      emitMerged();
    },
    (err) => {
      console.warn('conversations onSnapshot notice:', err);
    }
  );

  return () => {
    unsubChats();
    unsubLegacy();
  };
}

export function extractMessageEpochMs(data: Record<string, any>, docId?: string): number {
  return normalizeTimestamp({
    ...data,
    id: String(data.id || docId || ''),
  });
}

function resolveMessageLabel(data: Record<string, any>, docId?: string): string {
  return resolveServerTimeLabel({
    ...data,
    id: String(data.id || docId || ''),
  });
}

function getChatCollectionRoot(chatId: string): 'chats' | 'conversations' {
  if (chatId.startsWith('dm_') || chatId.startsWith('conv_')) {
    return 'conversations';
  }
  return 'chats';
}

export function subscribeToFirestoreMessages(
  chatId: string,
  onMessages: (msgs: Message[]) => void
): Unsubscribe {
  if (!chatId) return () => {};
  const rootCol = getChatCollectionRoot(chatId);
  const messagesRef = collection(db, rootCol, chatId, 'messages');

  return onSnapshot(
    messagesRef,
    { includeMetadataChanges: true },
    (snap) => {
      const list: Message[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const msgId = String(data.id || d.id);
        const epochMs = extractMessageEpochMs(data, msgId);
        const msgType = (data.type as Message['type']) || (data.stickerId ? 'sticker' : undefined);
        const clientCreatedAt =
          typeof data.clientCreatedAt === 'number' && Number.isFinite(data.clientCreatedAt)
            ? data.clientCreatedAt
            : typeof data.createdAtMs === 'number' && Number.isFinite(data.createdAtMs)
            ? data.createdAtMs
            : undefined;

        list.push({
          id: msgId,
          chatId,
          conversationId: String(data.conversationId || data.chatId || chatId),
          senderId: String(data.senderId || ''),
          senderName: String(data.senderName || 'JIT Member'),
          senderAvatar: typeof data.senderAvatar === 'string' ? data.senderAvatar : undefined,
          type: msgType,
          content: String(data.content || ''),
          mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
          mediaType: data.mediaType as Message['mediaType'],
          stickerId: typeof data.stickerId === 'string' ? data.stickerId : undefined,
          stickerData: typeof data.stickerData === 'string' ? data.stickerData : undefined,
          ...(data.gameInvite &&
          typeof data.gameInvite === 'object' &&
          typeof data.gameInvite.roomId === 'string'
            ? {
                gameInvite: {
                  roomId: String(data.gameInvite.roomId),
                  gameId: String(data.gameInvite.gameId || 'tictactoe'),
                  gameName: String(data.gameInvite.gameName || 'Multiplayer Match'),
                },
              }
            : {}),
          time: typeof data.time === 'string' ? data.time : undefined,
          date: typeof data.date === 'string' ? data.date : undefined,
          timestamp: data.timestamp || data.createdAtTs,
          clientCreatedAt,
          createdAt: epochMs,
          createdAtMs: epochMs,
          createdAtLabel: resolveMessageLabel(data, msgId),
          status: (data.status as Message['status']) || 'sent',
          readBy: Array.isArray(data.readBy)
            ? data.readBy.filter((x): x is string => typeof x === 'string')
            : undefined,
          readAt: data.readAt,
        });
      });
      onMessages(sortMessagesChronologically(list));
    },
    (err) => {
      console.warn('messages onSnapshot notice:', err);
    }
  );
}

export async function markChatMessagesAsRead(
  chatId: string,
  readerId: string,
  messageIds: string[]
): Promise<void> {
  if (!chatId || !readerId || messageIds.length === 0) return;
  const rootCol = getChatCollectionRoot(chatId);
  const uniqueIds = Array.from(new Set(messageIds.filter(Boolean)));
  const CHUNK_SIZE = 350;

  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const slice = uniqueIds.slice(i, i + CHUNK_SIZE);
    try {
      const batch = writeBatch(db);
      for (const msgId of slice) {
        const msgRef = doc(db, rootCol, chatId, 'messages', msgId);
        batch.update(msgRef, {
          status: 'read',
          readAt: serverTimestamp(),
          readBy: arrayUnion(readerId),
        });
      }
      await batch.commit();
    } catch {
      // Non-fatal if a message was removed or doc update raced
    }
  }
}

export async function updateChatTypingState(
  chatId: string,
  userId: string,
  isTyping: boolean
): Promise<void> {
  if (!chatId || !userId) return;
  const rootCol = getChatCollectionRoot(chatId);
  const chatRef = doc(db, rootCol, chatId);
  const safeUid = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (!safeUid) return;

  try {
    await updateDoc(chatRef, {
      [`typingUsers.${safeUid}`]: isTyping ? Date.now() : deleteField(),
    });
  } catch (err: any) {
    if (isTyping && err?.code === 'not-found') {
      try {
        await setDoc(
          chatRef,
          {
            id: chatId,
            typingUsers: { [safeUid]: Date.now() },
          },
          { merge: true }
        );
      } catch {
        // Ignore transient typing state errors
      }
    }
  }
}

export async function sendFirestoreDirectMessage(
  conversation: Conversation,
  sender: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl'>,
  payload: {
    id?: string;
    createdAtMs?: number;
    type?: Message['type'];
    content: string;
    mediaUrl?: string;
    mediaType?: 'image' | 'video' | 'file';
    stickerId?: string;
    stickerData?: string;
    gameInvite?: {
      roomId: string;
      gameId: string;
      gameName: string;
    };
  }
): Promise<Message> {
  const clientCreatedAt =
    typeof payload.createdAtMs === 'number' && Number.isFinite(payload.createdAtMs) && payload.createdAtMs > 0
      ? payload.createdAtMs
      : Date.now();
  const timeLabel = new Date(clientCreatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const msgId = (
    payload.id || `msg_${clientCreatedAt}_${Math.random().toString(36).slice(2, 7)}`
  ).slice(0, 120);
  const senderName = (sender.fullName || 'JIT Member').trim().slice(0, 120) || 'JIT Member';
  const senderAvatar = sanitizeAvatarUrl(sender.avatarUrl);
  const cleanContent = (payload.content || '').trim().slice(0, 4000);
  const safeMediaUrl =
    payload.mediaUrl && payload.mediaUrl.length <= 400000 ? payload.mediaUrl : undefined;
  const resolvedType: Message['type'] =
    payload.type ||
    (payload.gameInvite
      ? 'game_invite'
      : payload.stickerId
      ? 'sticker'
      : safeMediaUrl
      ? payload.mediaType || 'image'
      : 'text');
  const safeStickerId = payload.stickerId ? String(payload.stickerId).slice(0, 64) : undefined;
  const safeStickerData = payload.stickerData ? String(payload.stickerData).slice(0, 8000) : undefined;
  const safeGameInvite = payload.gameInvite
    ? {
        roomId: String(payload.gameInvite.roomId || '').slice(0, 64),
        gameId: String(payload.gameInvite.gameId || 'tictactoe').slice(0, 32),
        gameName: String(payload.gameInvite.gameName || 'Multiplayer Match').slice(0, 80),
      }
    : undefined;
  const previewText = (
    resolvedType === 'game_invite'
      ? cleanContent || `🎮 Invited you to ${safeGameInvite?.gameName || 'Game'} (Room #${safeGameInvite?.roomId || ''})`
      : resolvedType === 'sticker'
      ? cleanContent || '[Sticker]'
      : cleanContent || '[Media Attachment]'
  ).slice(0, 500);

  const chatId = conversation.id;
  const rootCol = getChatCollectionRoot(chatId);
  const chatRef = doc(db, rootCol, chatId);
  const participants = Array.from(
    new Set(
      (conversation.participantIds?.length ? conversation.participantIds : [sender.id]).filter(Boolean)
    )
  ).sort();
  const safeSenderKey = sender.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

  const msgDoc: Record<string, any> = {
    id: msgId,
    chatId,
    conversationId: chatId,
    senderId: sender.id,
    senderName,
    senderAvatar,
    type: resolvedType,
    content: cleanContent,
    ...(safeMediaUrl ? { mediaUrl: safeMediaUrl, mediaType: payload.mediaType || 'image' } : {}),
    ...(safeStickerId ? { stickerId: safeStickerId } : {}),
    ...(safeStickerData ? { stickerData: safeStickerData } : {}),
    ...(safeGameInvite ? { gameInvite: safeGameInvite } : {}),
    status: 'sent',
    readBy: [sender.id],
    timestamp: serverTimestamp(),
    clientCreatedAt,
  };

  const directRecipientId =
    conversation.type !== 'group'
      ? participants.find((pid) => pid !== sender.id)
      : undefined;
  if (directRecipientId && directRecipientId.length <= 64) {
    msgDoc.receiverId = directRecipientId;
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, rootCol, chatId, 'messages', msgId), msgDoc);
    batch.set(
      chatRef,
      {
        id: chatId,
        type: conversation.type || 'direct',
        name: (conversation.name || 'JIT Chat').slice(0, 120),
        avatarUrl: sanitizeAvatarUrl(conversation.avatarUrl),
        participants,
        participantIds: participants,
        participantsJson: JSON.stringify(conversation.participantsMap || {}).slice(0, 29500),
        lastMessage: previewText,
        lastMessageText: previewText,
        lastMessageSenderId: sender.id,
        lastMessageAt: timeLabel,
        updatedAtMs: clientCreatedAt,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (safeSenderKey) {
      batch.update(chatRef, {
        [`typingUsers.${safeSenderKey}`]: deleteField(),
      });
    }

    if (conversation.type === 'direct' && resolvedType !== 'game_invite') {
      const recipientId = directRecipientId || participants.find((pid) => pid !== sender.id);
      if (recipientId && recipientId.length >= 8) {
        const notifId = `notif_dm_${clientCreatedAt}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);
        batch.set(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: recipientId,
          fromUserId: sender.id,
          fromUserName: senderName,
          fromUserAvatar: senderAvatar,
          type: 'message',
          title: `Message from ${senderName}`,
          message: (resolvedType === 'sticker' ? 'Sent a sticker' : cleanContent || 'Sent an attachment').slice(0, 390),
          isRead: false,
          createdAtIso: new Date(clientCreatedAt).toISOString(),
          createdAtMs: clientCreatedAt,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `${rootCol}/${chatId}/messages/${msgId}`);
    }
    throw err;
  }

  return {
    id: msgId,
    chatId,
    conversationId: chatId,
    senderId: sender.id,
    ...(directRecipientId ? { receiverId: directRecipientId } : {}),
    senderName,
    senderAvatar,
    type: resolvedType,
    content: cleanContent,
    mediaUrl: safeMediaUrl,
    mediaType: safeMediaUrl ? payload.mediaType || 'image' : undefined,
    stickerId: safeStickerId,
    stickerData: safeStickerData,
    ...(safeGameInvite ? { gameInvite: safeGameInvite } : {}),
    clientCreatedAt,
    createdAt: clientCreatedAt,
    createdAtLabel: timeLabel,
    createdAtMs: clientCreatedAt,
    status: 'sent',
    readBy: [sender.id],
  };
}

export async function sendGameInviteToFriend(params: {
  fromUser: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl' | 'contactNumber'>;
  friend: Pick<UserProfile, 'id' | 'fullName' | 'avatarUrl' | 'contactNumber'>;
  roomId: string;
  gameId: string;
  gameName: string;
}): Promise<void> {
  const { fromUser, friend, roomId, gameId, gameName } = params;
  const cleanRoom = normalizeRoomId(roomId);
  if (!fromUser?.id || !friend?.id || !cleanRoom) return;

  const nowMs = Date.now();
  const senderName = (fromUser.fullName || 'JIT Player').trim().slice(0, 120) || 'JIT Player';
  const senderAvatar = sanitizeAvatarUrl(fromUser.avatarUrl);
  const cleanGameName = (gameName || gameId || 'Multiplayer Match').slice(0, 80);
  const inviteMsg = `${senderName} invited you to play ${cleanGameName} (Room #${cleanRoom})`;

  const notifId = `notif_gi_${nowMs}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);
  await setDoc(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: friend.id,
    fromUserId: fromUser.id,
    fromUserName: senderName,
    fromUserAvatar: senderAvatar,
    type: 'game_invite',
    title: `Game Invite: ${cleanGameName}`,
    message: inviteMsg.slice(0, 390),
    roomId: cleanRoom,
    gameId: String(gameId).slice(0, 32),
    gameName: cleanGameName,
    isRead: false,
    createdAtIso: new Date(nowMs).toISOString(),
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    const conv = await ensureFirestoreDirectConversation(fromUser, friend);
    await sendFirestoreDirectMessage(conv, fromUser, {
      type: 'game_invite',
      content: `🎮 Join my ${cleanGameName} match in Room #${cleanRoom}!`,
      gameInvite: {
        roomId: cleanRoom,
        gameId: String(gameId).slice(0, 32),
        gameName: cleanGameName,
      },
    });
  } catch (err) {
    console.warn('Game invite DM notice:', err);
  }
}

// ============================================================================
// VIDEO / REEL UPLOAD (FIREBASE STORAGE + FALLBACKS) & 40-DAY AUTO-EXPIRY
// ============================================================================

const CLOUD_VIDEO_CHUNK_RAW_BYTES = 480_000; // 480KB raw -> 640KB base64 (under 700KB Firestore chunk cap)
const MAX_CHUNKED_VIDEO_BYTES = 25 * 1024 * 1024; // 25MB max for chunked Firestore video sync
const resolvedChunkBlobCache = new Map<string, string>();
const inFlightChunkFetchMap = new Map<string, Promise<string>>();

export async function uploadChunkedVideoToFirestore(
  userId: string,
  file: File,
  expiresAt: number,
  onProgress?: (pct: number) => void
): Promise<string> {
  if (file.size > MAX_CHUNKED_VIDEO_BYTES) {
    throw new Error('Video file is too large for cloud fallback (max 25MB).');
  }

  const mediaId = `vmed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAtMs = Date.now();
  const mimeType = (file.type || 'video/mp4').slice(0, 64);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const totalBytes = bytes.byteLength;
  if (totalBytes <= 0) {
    throw new Error('Selected video file is empty.');
  }

  const totalChunks = Math.max(1, Math.ceil(totalBytes / CLOUD_VIDEO_CHUNK_RAW_BYTES));
  if (totalChunks > 60) {
    throw new Error('Video exceeds maximum chunked cloud storage limit.');
  }

  const { uint8ToBase64, cacheCloudVideoBlobLocally } = await import('../services/mediaStorage');

  // 1. Create parent metadata manifest doc first (required by Firestore Master Gate rule)
  await setDoc(doc(db, 'video_media', mediaId), {
    id: mediaId,
    creatorId: userId || 'usr_jit_member',
    mimeType,
    totalChunks,
    totalBytes,
    createdAtMs,
    expiresAt: Math.max(expiresAt, createdAtMs + VIDEO_EXPIRY_MS),
    createdAt: serverTimestamp(),
  });

  // 2. Upload base64 chunks in parallel batches of 4
  const BATCH_SIZE = 4;
  let uploadedCount = 0;
  for (let start = 0; start < totalChunks; start += BATCH_SIZE) {
    const end = Math.min(totalChunks, start + BATCH_SIZE);
    const promises: Promise<void>[] = [];
    for (let idx = start; idx < end; idx++) {
      const sliceStart = idx * CLOUD_VIDEO_CHUNK_RAW_BYTES;
      const sliceEnd = Math.min(totalBytes, sliceStart + CLOUD_VIDEO_CHUNK_RAW_BYTES);
      const b64 = uint8ToBase64(bytes.subarray(sliceStart, sliceEnd));
      const chunkId = `c_${String(idx).padStart(3, '0')}`;
      promises.push(
        setDoc(doc(db, 'video_media', mediaId, 'chunks', chunkId), {
          id: chunkId,
          mediaId,
          index: idx,
          data: b64,
          createdAt: serverTimestamp(),
        }).then(() => {
          uploadedCount++;
          const pct = Math.min(98, Math.round(55 + (uploadedCount / totalChunks) * 43));
          onProgress?.(pct);
        })
      );
    }
    await Promise.all(promises);
  }

  // 3. Cache locally in IndexedDB and in memory so uploader gets instant zero-latency playback too
  await cacheCloudVideoBlobLocally(mediaId, file, expiresAt);
  try {
    const localBlobUrl = URL.createObjectURL(file);
    resolvedChunkBlobCache.set(mediaId, localBlobUrl);
  } catch {
    // Ignore object URL errors in non-DOM contexts
  }

  onProgress?.(100);
  return `fschunk://${mediaId}`;
}

export async function fetchCloudChunkedVideoBlobUrl(uri: string): Promise<string> {
  const mediaId = uri.startsWith('fschunk://') ? uri.slice('fschunk://'.length).trim() : uri.trim();
  if (!mediaId) return '';

  const memCached = resolvedChunkBlobCache.get(mediaId);
  if (memCached) return memCached;

  const existingPromise = inFlightChunkFetchMap.get(mediaId);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    try {
      const { getCachedCloudVideoUrl, cacheCloudVideoBlobLocally, base64ToUint8 } = await import(
        '../services/mediaStorage'
      );

      // 1. Check local IndexedDB read-through cache first
      const idbUrl = await getCachedCloudVideoUrl(mediaId);
      if (idbUrl) {
        resolvedChunkBlobCache.set(mediaId, idbUrl);
        return idbUrl;
      }

      // 2. Fetch metadata + sequential base64 chunks from Firestore
      const metaSnap = await getDoc(doc(db, 'video_media', mediaId));
      if (!metaSnap.exists()) {
        return '';
      }
      const meta = metaSnap.data();
      const mimeType = typeof meta.mimeType === 'string' && meta.mimeType ? meta.mimeType : 'video/mp4';
      const expiresAt = typeof meta.expiresAt === 'number' ? meta.expiresAt : Date.now() + VIDEO_EXPIRY_MS;

      const chunksSnap = await getDocs(
        query(collection(db, 'video_media', mediaId, 'chunks'), where('index', '>=', 0), limit(80))
      );
      if (chunksSnap.empty) {
        return '';
      }

      const orderedChunks: Array<{ index: number; data: string }> = [];
      chunksSnap.forEach((d) => {
        const data = d.data();
        if (typeof data.data === 'string' && typeof data.index === 'number') {
          orderedChunks.push({ index: data.index, data: data.data });
        }
      });
      orderedChunks.sort((a, b) => a.index - b.index);

      if (orderedChunks.length === 0) {
        return '';
      }

      const binaryParts = orderedChunks.map((c) => base64ToUint8(c.data) as BlobPart);
      const assembledBlob = new Blob(binaryParts, { type: mimeType });
      await cacheCloudVideoBlobLocally(mediaId, assembledBlob, expiresAt);

      const blobUrl = URL.createObjectURL(assembledBlob);
      resolvedChunkBlobCache.set(mediaId, blobUrl);
      return blobUrl;
    } finally {
      inFlightChunkFetchMap.delete(mediaId);
    }
  })();

  inFlightChunkFetchMap.set(mediaId, promise);
  return promise;
}

export async function uploadVideoAssetToCloud(
  userId: string,
  file: File,
  thumbnailDataUrl: string,
  expiresAt: number,
  onProgress?: (pct: number) => void
): Promise<{ videoUrl: string; thumbnailUrl: string; storageSource: 'firebase' | 'server' | 'firestore' }> {
  const mediaId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = (file.name.split('.').pop() || 'mp4').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'mp4';

  let finalThumb = thumbnailDataUrl && thumbnailDataUrl.length <= 170_000 ? thumbnailDataUrl : '';

  // 1. Try Firebase Storage first (uploads video & thumbnail with fast failback)
  try {
    onProgress?.(10);
    const videoPath = `videos/${userId}/${mediaId}.${ext}`;
    const videoRef = storageRef(storage, videoPath);

    const videoDownloadUrl = await new Promise<string>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        try {
          task.cancel();
        } catch {
          // ignore
        }
        reject(new Error('Firebase Storage upload timed out'));
      }, 15000);

      const task = uploadBytesResumable(videoRef, file, {
        contentType: file.type || 'video/mp4',
        customMetadata: {
          userId,
          expiresAt: String(expiresAt),
        },
      });

      task.on(
        'state_changed',
        (snap) => {
          if (snap.totalBytes > 0) {
            const pct = Math.min(90, Math.max(10, Math.round((snap.bytesTransferred / snap.totalBytes) * 85)));
            onProgress?.(pct);
          }
        },
        (err) => {
          window.clearTimeout(timeoutId);
          reject(err);
        },
        async () => {
          window.clearTimeout(timeoutId);
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve(url);
          } catch (e) {
            reject(e);
          }
        }
      );
    });

    if (videoDownloadUrl && videoDownloadUrl.startsWith('http')) {
      if (finalThumb && finalThumb.startsWith('data:image/')) {
        try {
          const thumbRef = storageRef(storage, `thumbnails/${userId}/${mediaId}.jpg`);
          await uploadString(thumbRef, finalThumb, 'data_url');
          const thumbUrl = await getDownloadURL(thumbRef);
          if (thumbUrl && thumbUrl.startsWith('http')) {
            finalThumb = thumbUrl;
          }
        } catch {
          // Keep compact inline JPEG thumbnail
        }
      }
      onProgress?.(100);
      return { videoUrl: videoDownloadUrl, thumbnailUrl: finalThumb, storageSource: 'firebase' };
    }
  } catch (err) {
    console.info('Firebase Storage video upload fallback engaged:', err);
  }

  // 2. Try Express binary /api/media/upload only when Express backend API is active
  if (typeof window !== 'undefined' && typeof fetch === 'function' && (await detectExpressBackendAvailable())) {
    onProgress?.(55);
    const res = await safeFetchJson<{ url?: string }>('/api/media/upload', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Media-Mime': file.type || 'video/mp4',
        'X-Expires-At': String(expiresAt),
      },
      body: file,
    });
    if (res.ok && res.data?.url) {
      onProgress?.(100);
      return { videoUrl: String(res.data.url), thumbnailUrl: finalThumb, storageSource: 'server' };
    }
  }

  // 3. Direct Firestore Base64 Data URL for compact clips (<= 520KB binary -> <= 720KB Base64 string)
  if (file.size <= 520_000) {
    try {
      onProgress?.(75);
      const { fileToDataUrl } = await import('../services/mediaStorage');
      const dataUrl = await fileToDataUrl(file);
      if (dataUrl.length <= 720_000) {
        onProgress?.(100);
        return { videoUrl: dataUrl, thumbnailUrl: finalThumb, storageSource: 'firestore' };
      }
    } catch {
      // Fall through to chunked Firestore Base64 storage
    }
  }

  // 4. Universal Cross-Device Cloud Fallback: Chunked Base64 Storage in Firestore (`fschunk://<mediaId>`)
  //    Ensures ALL users on ANY browser/device globally stream the exact video without device-only blobs!
  onProgress?.(55);
  const fschunkUri = await uploadChunkedVideoToFirestore(userId, file, expiresAt, onProgress);
  return { videoUrl: fschunkUri, thumbnailUrl: finalThumb, storageSource: 'firestore' };
}

export function isAccessibleVideoUrl(url?: string): boolean {
  return isValidVideoUrl(url);
}

function normalizeEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 && value > 1_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 && numeric > 1_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function unwrapSingleMediaString(val: unknown): string {
  let raw = '';
  if (typeof val === 'string') {
    raw = val.trim();
  } else if (val && typeof val === 'object' && 'url' in val && typeof (val as any).url === 'string') {
    raw = (val as any).url.trim();
  }
  if (!raw || isPlaceholderOrInvalidMediaString(raw)) return '';
  return raw;
}

function isLikelyVideoUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:video/') || lower.startsWith('fschunk://')) return true;
  const cleanPath = lower.split('?')[0].split('#')[0];
  return (
    cleanPath.endsWith('.mp4') ||
    cleanPath.endsWith('.webm') ||
    cleanPath.endsWith('.mov') ||
    cleanPath.endsWith('.ogv') ||
    lower.includes('videos%2f') ||
    lower.includes('/videos/')
  );
}

function sanitizePostCandidateUrl(url: string): string | undefined {
  if (!url || isPlaceholderOrInvalidMediaString(url)) return undefined;
  if (isLikelyVideoUrl(url)) {
    return sanitizeVideoUrl(url);
  }
  return isValidImageUrl(url) ? url : undefined;
}

function unwrapPostMediaFields(data: Record<string, any>): {
  mediaUrls: string[] | undefined;
  mediaUrl: string | undefined;
  videoUrl: string | undefined;
  mediaType: 'image' | 'video' | 'none';
  primaryUrl: string | undefined;
} {
  const candidates: string[] = [];
  const pushCandidate = (rawVal: unknown, unshift = false) => {
    const unwrapped = unwrapSingleMediaString(rawVal);
    const valid = unwrapped ? sanitizePostCandidateUrl(unwrapped) : undefined;
    if (valid && !candidates.includes(valid)) {
      if (unshift) candidates.unshift(valid);
      else candidates.push(valid);
    }
  };

  if (Array.isArray(data.mediaUrls)) {
    for (const entry of data.mediaUrls) {
      pushCandidate(entry);
    }
  } else if (typeof data.mediaUrls === 'string' && data.mediaUrls.trim()) {
    const raw = data.mediaUrls.trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            pushCandidate(entry);
          }
        }
      } catch {
        pushCandidate(raw);
      }
    } else {
      pushCandidate(raw);
    }
  }

  const rawVideoUrl = unwrapSingleMediaString(data.videoUrl);
  const videoUrl = sanitizeVideoUrl(rawVideoUrl);
  const rawMediaUrl = unwrapSingleMediaString(data.mediaUrl);
  const mediaUrl = rawMediaUrl ? sanitizePostCandidateUrl(rawMediaUrl) : undefined;
  const rawImageUrl = unwrapSingleMediaString(data.imageUrl);
  const imageUrl = rawImageUrl && isValidImageUrl(rawImageUrl) ? rawImageUrl : undefined;

  if (videoUrl && !candidates.includes(videoUrl)) candidates.unshift(videoUrl);
  if (mediaUrl && !candidates.includes(mediaUrl)) candidates.push(mediaUrl);
  if (imageUrl && !candidates.includes(imageUrl)) candidates.push(imageUrl);

  const primaryUrl = candidates[0];
  let mediaType: 'image' | 'video' | 'none' = 'none';

  if (videoUrl || (primaryUrl && isLikelyVideoUrl(primaryUrl) && isValidVideoUrl(primaryUrl))) {
    mediaType = 'video';
  } else if (primaryUrl && isValidImageUrl(primaryUrl)) {
    mediaType = 'image';
  } else if (
    (data.mediaType === 'image' || data.mediaType === 'video') &&
    primaryUrl
  ) {
    mediaType = data.mediaType;
  }

  return {
    mediaUrls: candidates.length > 0 ? candidates : undefined,
    mediaUrl,
    videoUrl,
    mediaType,
    primaryUrl,
  };
}

function extractItemPrimaryVideoUrl(item: {
  videoUrl?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
}): string | undefined {
  if (typeof item.videoUrl === 'string' && item.videoUrl.trim()) {
    return item.videoUrl.trim();
  }
  if (typeof item.mediaUrl === 'string' && item.mediaUrl.trim()) {
    return item.mediaUrl.trim();
  }
  if (Array.isArray(item.mediaUrls)) {
    return item.mediaUrls.find((u) => typeof u === 'string' && u.trim().length > 0)?.trim();
  }
  return undefined;
}

export function isVideoContentExpired(
  item: {
    expiresAt?: number | string;
    createdAtMs?: number;
    mediaType?: string;
    videoUrl?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
  },
  options?: { enforceStrictAgeOnly?: boolean }
): boolean {
  if (item.mediaType === 'image' || item.mediaType === 'none') {
    return false;
  }

  const primaryUrl = extractItemPrimaryVideoUrl(item);
  // Bypass expiry filtering for valid, accessible video URLs so playable videos always render
  if (!options?.enforceStrictAgeOnly && isAccessibleVideoUrl(primaryUrl)) {
    return false;
  }

  const now = Date.now();
  const createdAtMs = normalizeEpochMs(item.createdAtMs);
  const expiresAtMs = normalizeEpochMs(item.expiresAt);

  // Enforce the exact 40-day window from creation time so newly uploaded videos never trigger false expiry
  if (createdAtMs && createdAtMs > 1_000_000_000_000) {
    const minimumFullExpiry = createdAtMs + VIDEO_EXPIRY_MS;
    const effectiveExpiry =
      expiresAtMs && expiresAtMs > minimumFullExpiry ? expiresAtMs : minimumFullExpiry;
    return now >= effectiveExpiry;
  }

  if (expiresAtMs && expiresAtMs > 1_000_000_000_000) {
    return now >= expiresAtMs;
  }

  return false;
}

export async function publishFirestoreReel(reel: Reel): Promise<void> {
  const createdAtMs = reel.createdAtMs || Date.now();
  const expiresAt =
    reel.expiresAt && reel.expiresAt >= createdAtMs + VIDEO_EXPIRY_MS
      ? reel.expiresAt
      : createdAtMs + VIDEO_EXPIRY_MS;
  const safeVideoUrl =
    reel.videoUrl && reel.videoUrl.length <= 740_000 ? reel.videoUrl : '';
  const safeThumb =
    reel.thumbnailUrl && reel.thumbnailUrl.length <= 175_000 ? reel.thumbnailUrl : '';

  const payload: Record<string, any> = {
    id: reel.id,
    creatorId: reel.creatorId,
    creatorName: (reel.creatorName || 'JIT Member').slice(0, 120),
    creatorAvatar: sanitizeAvatarUrl(reel.creatorAvatar),
    videoUrl: safeVideoUrl,
    ...(safeThumb ? { thumbnailUrl: safeThumb } : {}),
    caption: (reel.caption || 'JIT Campus Reel').slice(0, 1000),
    musicTitle: (reel.musicTitle || 'JIT Original Sound').slice(0, 120),
    likesCount: Math.max(0, Number(reel.likesCount || 0)),
    commentsCount: Math.max(0, Number(reel.commentsCount || 0)),
    sharesCount: Math.max(0, Number(reel.sharesCount || 0)),
    viewsCount: Math.max(0, Number(reel.viewsCount || 1)),
    likedBy: Array.isArray(reel.likedBy) ? reel.likedBy.slice(0, 500) : [],
    commentsJson: JSON.stringify(reel.comments || []).slice(0, 95000),
    createdAt: (reel.createdAt || 'Just now').slice(0, 40),
    createdAtMs,
    expiresAt,
    createdAtTs: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'reels', reel.id), payload);
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `reels/${reel.id}`);
    }
    console.warn('publishFirestoreReel notice:', err);
  }
}

export function subscribeToFirestoreReels(
  onReels: (reels: Reel[]) => void
): Unsubscribe {
  const q = query(collection(db, 'reels'), where('createdAtMs', '>=', 0), limit(80));
  return onSnapshot(
    q,
    (snap) => {
      const active: Reel[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
        const createdAtMs = Number(data.createdAtMs || 0);
        const rawReelVideoUrl = unwrapSingleMediaString(data.videoUrl || data.mediaUrl || (Array.isArray(data.mediaUrls) ? data.mediaUrls[0] : ''));
        const videoUrl = sanitizeVideoUrl(rawReelVideoUrl) || '';
        if (
          isVideoContentExpired(
            { expiresAt, createdAtMs, mediaType: 'video', videoUrl },
            { enforceStrictAgeOnly: true }
          ) &&
          !isAccessibleVideoUrl(videoUrl)
        ) {
          // Auto-remove genuinely expired reel (>40 days old) from Firestore
          deleteDoc(d.ref).catch(() => {});
          return;
        }
        let comments: any[] = [];
        try {
          const parsed = JSON.parse(data.commentsJson || '[]');
          if (Array.isArray(parsed)) comments = parsed;
        } catch {
          comments = [];
        }
        active.push({
          id: String(data.id || d.id),
          creatorId: String(data.creatorId || ''),
          creatorName: String(data.creatorName || 'JIT Member'),
          creatorAvatar: typeof data.creatorAvatar === 'string' ? data.creatorAvatar : undefined,
          videoUrl,
          mediaUrl: sanitizeVideoUrl(data.mediaUrl),
          thumbnailUrl: typeof data.thumbnailUrl === 'string' && isValidImageUrl(data.thumbnailUrl) ? data.thumbnailUrl : undefined,
          caption: String(data.caption || ''),
          musicTitle: typeof data.musicTitle === 'string' ? data.musicTitle : undefined,
          likesCount: Number(data.likesCount || 0),
          commentsCount: Number(data.commentsCount || 0),
          sharesCount: Number(data.sharesCount || 0),
          viewsCount: Number(data.viewsCount || 1),
          likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
          comments,
          createdAt: String(data.createdAt || 'Just now'),
          createdAtMs,
          expiresAt,
        });
      });
      active.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      onReels(active);
    },
    (err) => {
      console.warn('reels onSnapshot notice:', err);
    }
  );
}

export async function updateFirestoreReelInteraction(
  reelId: string,
  patch: {
    likedBy?: string[];
    likesCount?: number;
    commentsJson?: string;
    commentsCount?: number;
  }
): Promise<void> {
  if (!reelId) return;
  try {
    await updateDoc(doc(db, 'reels', reelId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('updateFirestoreReelInteraction notice:', err);
  }
}

export async function publishFirestorePost(post: Post): Promise<void> {
  const createdAtMs = post.createdAtMs || Date.now();
  const expiresAt =
    post.mediaType === 'video'
      ? post.expiresAt && post.expiresAt >= createdAtMs + VIDEO_EXPIRY_MS
        ? post.expiresAt
        : createdAtMs + VIDEO_EXPIRY_MS
      : post.expiresAt;
  const safeMediaUrls = Array.isArray(post.mediaUrls)
    ? post.mediaUrls.filter((u) => typeof u === 'string' && u.length <= 740_000).slice(0, 4)
    : undefined;
  const safeThumb =
    post.thumbnailUrl && post.thumbnailUrl.length <= 175_000 ? post.thumbnailUrl : undefined;

  const payload: Record<string, any> = {
    id: post.id,
    authorId: post.authorId,
    authorName: (post.authorName || 'JIT Member').slice(0, 120),
    authorAvatar: sanitizeAvatarUrl(post.authorAvatar),
    authorHandle: (post.authorHandle || '@jit_member').slice(0, 80),
    content: (post.content || '').slice(0, 5000),
    ...(safeMediaUrls && safeMediaUrls.length > 0 ? { mediaUrls: safeMediaUrls } : {}),
    mediaType: post.mediaType || 'none',
    ...(safeThumb ? { thumbnailUrl: safeThumb } : {}),
    category: post.category || 'all',
    likesCount: Math.max(0, Number(post.likesCount || 0)),
    commentsCount: Math.max(0, Number(post.commentsCount || 0)),
    sharesCount: Math.max(0, Number(post.sharesCount || 0)),
    likedBy: Array.isArray(post.likedBy) ? post.likedBy.slice(0, 500) : [],
    commentsJson: JSON.stringify(post.comments || []).slice(0, 95000),
    createdAt: (post.createdAt || 'Just now').slice(0, 40),
    createdAtMs,
    ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
    createdAtTs: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'posts', post.id), payload);
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `posts/${post.id}`);
    }
    console.warn('publishFirestorePost notice:', err);
  }
}

export function subscribeToFirestorePosts(
  onPosts: (posts: Post[]) => void
): Unsubscribe {
  const q = query(collection(db, 'posts'), where('createdAtMs', '>=', 0), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const active: Post[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const unwrapped = unwrapPostMediaFields(data);
        const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
        const createdAtMs = Number(data.createdAtMs || 0);
        if (
          unwrapped.mediaType === 'video' &&
          isVideoContentExpired(
            {
              expiresAt,
              createdAtMs,
              mediaType: unwrapped.mediaType,
              mediaUrls: unwrapped.mediaUrls,
              mediaUrl: unwrapped.mediaUrl,
              videoUrl: unwrapped.videoUrl,
            },
            { enforceStrictAgeOnly: true }
          ) &&
          !isAccessibleVideoUrl(unwrapped.primaryUrl)
        ) {
          // Auto-remove genuinely expired video post (>40 days old) from Firestore
          deleteDoc(d.ref).catch(() => {});
          return;
        }
        let comments: any[] = [];
        try {
          const parsed = JSON.parse(data.commentsJson || '[]');
          if (Array.isArray(parsed)) comments = parsed;
        } catch {
          comments = [];
        }
        active.push({
          id: String(data.id || d.id),
          authorId: String(data.authorId || ''),
          authorName: String(data.authorName || 'JIT Member'),
          authorAvatar: typeof data.authorAvatar === 'string' ? data.authorAvatar : undefined,
          authorHandle: typeof data.authorHandle === 'string' ? data.authorHandle : undefined,
          content: String(data.content || ''),
          mediaUrls: unwrapped.mediaUrls,
          ...(unwrapped.mediaUrl ? { mediaUrl: unwrapped.mediaUrl } : {}),
          ...(unwrapped.videoUrl ? { videoUrl: unwrapped.videoUrl } : {}),
          mediaType: unwrapped.mediaType,
          thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
          category: (data.category as Post['category']) || 'all',
          likesCount: Number(data.likesCount || 0),
          commentsCount: Number(data.commentsCount || 0),
          sharesCount: Number(data.sharesCount || 0),
          likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
          comments,
          createdAt: String(data.createdAt || 'Just now'),
          createdAtMs,
          expiresAt,
        });
      });
      active.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      onPosts(active);
    },
    (err) => {
      console.warn('posts onSnapshot notice:', err);
    }
  );
}

export async function updateFirestorePostInteraction(
  postId: string,
  patch: Record<string, any>
): Promise<void> {
  if (!postId) return;
  try {
    await updateDoc(doc(db, 'posts', postId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('updateFirestorePostInteraction notice:', err);
  }
}

export async function deleteFirestorePost(postId: string): Promise<void> {
  if (!postId) return;
  try {
    await deleteDoc(doc(db, 'posts', postId));
  } catch (err) {
    console.warn('deleteFirestorePost notice:', err);
  }
}

/**
 * Sweeps Firestore `reels` and `posts` for any video whose genuine 40-day `expiresAt`
 * window has elapsed and deletes them automatically.
 */
export async function purgeExpiredCloudVideos(): Promise<number> {
  const now = Date.now();
  let deletedCount = 0;

  try {
    const expiredReelsQ = query(
      collection(db, 'reels'),
      where('expiresAt', '>=', 0),
      where('expiresAt', '<=', now),
      limit(50)
    );
    const reelsSnap = await getDocs(expiredReelsQ);
    for (const d of reelsSnap.docs) {
      try {
        const data = d.data();
        if (
          isVideoContentExpired(
            {
              expiresAt: data.expiresAt,
              createdAtMs: data.createdAtMs,
              mediaType: 'video',
              videoUrl: data.videoUrl,
            },
            { enforceStrictAgeOnly: true }
          )
        ) {
          await deleteDoc(d.ref);
          deletedCount++;
        }
      } catch {
        // Ignore if already deleted
      }
    }
  } catch (err) {
    console.warn('purgeExpiredCloudVideos reels notice:', err);
  }

  try {
    const expiredPostsQ = query(
      collection(db, 'posts'),
      where('expiresAt', '>=', 0),
      where('expiresAt', '<=', now),
      limit(50)
    );
    const postsSnap = await getDocs(expiredPostsQ);
    for (const d of postsSnap.docs) {
      try {
        const data = d.data();
        if (
          data?.mediaType === 'video' &&
          isVideoContentExpired(
            {
              expiresAt: data.expiresAt,
              createdAtMs: data.createdAtMs,
              mediaType: 'video',
              mediaUrls: data.mediaUrls,
            },
            { enforceStrictAgeOnly: true }
          )
        ) {
          await deleteDoc(d.ref);
          deletedCount++;
        }
      } catch {
        // Ignore if already deleted
      }
    }
  } catch (err) {
    console.warn('purgeExpiredCloudVideos posts notice:', err);
  }

  return deletedCount;
}

// ============================================================================
// ADMIN PANEL CLIENT CONTROLS (USER EDITS, MODERATION, DM INSPECTION,
// POSTS / REELS / MATCH LOG DELETION & GLOBAL ANNOUNCEMENTS WITH MEDIA)
// ============================================================================

export async function deleteFirestoreReel(reelId: string): Promise<void> {
  if (!reelId) return;
  try {
    await deleteDoc(doc(db, 'reels', reelId));
  } catch (err) {
    console.warn('deleteFirestoreReel notice:', err);
  }
}

export async function deleteFirestoreMatchRecord(matchId: string): Promise<void> {
  if (!matchId) return;
  try {
    await deleteDoc(doc(db, 'match_history', matchId));
  } catch (err) {
    console.warn('deleteFirestoreMatchRecord notice:', err);
  }
}

export async function adminOverrideCloudProfileClient(
  baseProfile: UserProfile,
  edits: {
    fullName?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
    coverUrl?: string;
    status?: UserProfile['status'];
    rewardPoints?: number;
  }
): Promise<UserProfile> {
  const nowIso = new Date().toISOString();
  const nextStats = sanitizeStats({
    ...baseProfile.stats,
    ...(edits.rewardPoints !== undefined ? { rewardPoints: edits.rewardPoints } : {}),
  });
  const nextFullName =
    edits.fullName !== undefined
      ? edits.fullName.trim().slice(0, 120) || baseProfile.fullName
      : baseProfile.fullName;
  const nextUsername = deriveUsername(
    nextFullName,
    baseProfile.contactNumber,
    edits.username !== undefined ? edits.username : baseProfile.username
  );
  const nextStatus: UserProfile['status'] =
    edits.status && ['active', 'suspended', 'deleted'].includes(edits.status)
      ? edits.status
      : baseProfile.status || 'active';

  const nextProfile: UserProfile = {
    ...baseProfile,
    fullName: nextFullName,
    username: nextUsername,
    bio: edits.bio !== undefined ? edits.bio.slice(0, 500) : baseProfile.bio || '',
    avatarUrl:
      edits.avatarUrl !== undefined
        ? sanitizeAvatarUrl(edits.avatarUrl)
        : baseProfile.avatarUrl || '/assets/aistudio/image_e64e54f2.png',
    coverUrl:
      edits.coverUrl === ''
        ? undefined
        : edits.coverUrl !== undefined && edits.coverUrl.length <= 395000
        ? edits.coverUrl
        : baseProfile.coverUrl,
    status: nextStatus,
    suspendedReason: nextStatus === 'active' ? undefined : baseProfile.suspendedReason,
    suspendedAt: nextStatus === 'active' ? undefined : baseProfile.suspendedAt,
    lastLoginAt: nowIso,
    lastLogin: nowIso,
    stats: nextStats,
  };

  const profileRef = doc(db, 'profiles', baseProfile.id);
  const snap = await getDoc(profileRef).catch(() => null);
  if (snap && snap.exists()) {
    const patch: Record<string, any> = {
      fullName: nextProfile.fullName,
      username: nextUsername,
      bio: nextProfile.bio || '',
      avatarUrl: nextProfile.avatarUrl,
      status: nextStatus,
      suspendedReason: nextStatus === 'active' ? '' : nextProfile.suspendedReason || '',
      suspendedAt: nextStatus === 'active' ? '' : nextProfile.suspendedAt || '',
      stats: nextStats,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    };
    if (edits.coverUrl === '') {
      patch.coverUrl = '';
    } else if (nextProfile.coverUrl !== undefined) {
      patch.coverUrl = nextProfile.coverUrl;
    }
    await updateDoc(profileRef, patch);
  } else {
    await ensureCloudProfileSeeded(nextProfile);
  }

  if (nextStatus === 'deleted') {
    await Promise.allSettled([
      deleteDoc(doc(db, 'user_directory', baseProfile.id)),
      deleteDoc(doc(db, 'leaderboard', baseProfile.id)),
    ]);
  } else {
    await Promise.allSettled([
      setDoc(doc(db, 'user_directory', nextProfile.id), buildUserDirectoryPayload(nextProfile)),
      syncLeaderboardEntry(nextProfile),
    ]);
  }
  invalidateDirectoryCache();

  return nextProfile;
}

export async function adminModerateCloudProfileClient(
  profile: UserProfile,
  action: 'suspend' | 'unblock' | 'delete',
  reason?: string
): Promise<UserProfile> {
  const nowIso = new Date().toISOString();
  const nextStatus: UserProfile['status'] =
    action === 'suspend' ? 'suspended' : action === 'delete' ? 'deleted' : 'active';
  const cleanReason =
    action === 'suspend'
      ? (reason || 'Account suspended by administrator.').trim().slice(0, 300)
      : action === 'delete'
      ? 'Account deleted by administrator.'
      : '';
  const suspendedAt = action === 'unblock' ? '' : nowIso;

  const profileRef = doc(db, 'profiles', profile.id);
  const snap = await getDoc(profileRef).catch(() => null);
  if (snap && snap.exists()) {
    await updateDoc(profileRef, {
      status: nextStatus,
      suspendedReason: cleanReason,
      suspendedAt,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      lastActiveAt: serverTimestamp(),
    });
  }

  if (action === 'delete') {
    await Promise.allSettled([
      deleteDoc(doc(db, 'user_directory', profile.id)),
      deleteDoc(doc(db, 'leaderboard', profile.id)),
    ]);
  }
  invalidateDirectoryCache();

  return {
    ...profile,
    status: nextStatus,
    suspendedReason: cleanReason || undefined,
    suspendedAt: suspendedAt || undefined,
    lastLoginAt: nowIso,
    lastLogin: nowIso,
  };
}

export async function adminFetchUserChatActivityClient(
  userId: string
): Promise<{
  conversations: Conversation[];
  messages: Array<Message & { createdAtMs?: number }>;
}> {
  const convMap = new Map<string, Conversation>();
  const msgMap = new Map<string, Message & { createdAtMs?: number }>();

  const toConv = (id: string, data: Record<string, any>): Conversation => {
    const participantIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
    const pMap = parseParticipantsMap(data.participantsJson);
    const type = data.type === 'group' ? 'group' : 'direct';
    const peerId = type === 'direct' ? participantIds.find((pid) => pid !== userId) : undefined;
    const peerInfo = peerId ? pMap[peerId] : undefined;
    return {
      id: String(data.id || id),
      type,
      name: peerInfo?.name || String(data.name || 'Conversation'),
      avatarUrl: peerInfo?.avatar || (typeof data.avatarUrl === 'string' ? data.avatarUrl : undefined),
      participantIds,
      participantsMap: pMap,
      lastMessage: data.lastMessageText
        ? {
            text: String(data.lastMessageText),
            senderId: String(data.lastMessageSenderId || ''),
            createdAt: String(data.lastMessageAt || ''),
            isRead: true,
          }
        : undefined,
      unreadCount: 0,
      updatedAt: String(data.lastMessageAt || 'Recent'),
      updatedAtMs: Number(data.updatedAtMs || 0),
    };
  };

  const toMsg = (id: string, fallbackConvId: string, data: Record<string, any>): Message & { createdAtMs?: number } => {
    const epochMs = extractMessageEpochMs(data, id);
    const msgType = (data.type as Message['type']) || (data.stickerId ? 'sticker' : undefined);
    const label = resolveMessageLabel(data, id);
    return {
      id: String(data.id || id),
      chatId: String(data.chatId || data.conversationId || fallbackConvId),
      conversationId: String(data.conversationId || data.chatId || fallbackConvId),
      senderId: String(data.senderId || ''),
      receiverId: typeof data.receiverId === 'string' ? data.receiverId : undefined,
      senderName: String(data.senderName || 'JIT Member'),
      senderAvatar: typeof data.senderAvatar === 'string' ? data.senderAvatar : undefined,
      type: msgType,
      content: String(data.content || ''),
      mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
      mediaType: data.mediaType as Message['mediaType'],
      stickerId: typeof data.stickerId === 'string' ? data.stickerId : undefined,
      stickerData: typeof data.stickerData === 'string' ? data.stickerData : undefined,
      time: typeof data.time === 'string' ? data.time : undefined,
      date: typeof data.date === 'string' ? data.date : undefined,
      timestamp: data.timestamp || data.createdAtTs,
      clientCreatedAt:
        typeof data.clientCreatedAt === 'number' ? data.clientCreatedAt : undefined,
      createdAt: epochMs > 0 ? epochMs : label,
      createdAtLabel: label,
      createdAtMs: epochMs,
      status: (data.status as Message['status']) || 'delivered',
    };
  };

  // 1. Primary conversation queries across both canonical /chats and legacy /conversations
  const [chatsRes, partRes, recentRes] = await Promise.allSettled([
    getDocs(query(collection(db, 'chats'), where('participants', 'array-contains', userId), limit(100))),
    getDocs(query(collection(db, 'conversations'), where('participantIds', 'array-contains', userId), limit(100))),
    getDocs(query(collection(db, 'conversations'), limit(100))),
  ]);

  if (chatsRes.status === 'fulfilled') {
    chatsRes.value.forEach((d) => {
      const conv = toConv(d.id, d.data());
      convMap.set(conv.id, conv);
    });
  }

  if (partRes.status === 'fulfilled') {
    partRes.value.forEach((d) => {
      const conv = toConv(d.id, d.data());
      if (!convMap.has(conv.id)) convMap.set(conv.id, conv);
    });
  }

  if (recentRes.status === 'fulfilled') {
    recentRes.value.forEach((d) => {
      const data = d.data();
      const participantIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
      const pMap = parseParticipantsMap(data.participantsJson);
      const matchesUser =
        participantIds.includes(userId) ||
        data.lastMessageSenderId === userId ||
        d.id.includes(userId) ||
        Boolean(pMap[userId]);
      if (matchesUser && !convMap.has(String(data.id || d.id))) {
        const conv = toConv(d.id, data);
        convMap.set(conv.id, conv);
      }
    });
  }

  // 2. Fetch all messages inside every matched conversation (/chats or /conversations)
  const convIds = Array.from(convMap.keys());
  const CHUNK = 10;
  for (let i = 0; i < convIds.length; i += CHUNK) {
    const slice = convIds.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (cid) => {
        const rootCol = getChatCollectionRoot(cid);
        try {
          const snap = await getDocs(
            query(collection(db, rootCol, cid, 'messages'), limit(300))
          );
          snap.forEach((d) => {
            const msg = toMsg(d.id, cid, d.data());
            msgMap.set(msg.id, msg);
          });
        } catch {
          // Continue cleanly
        }
      })
    );
  }

  // 3. CollectionGroup fallback query matching senderId == userId or receiverId == userId
  try {
    const [sentCg, recvCg] = await Promise.allSettled([
      getDocs(query(collectionGroup(db, 'messages'), where('senderId', '==', userId), limit(200))),
      getDocs(query(collectionGroup(db, 'messages'), where('receiverId', '==', userId), limit(200))),
    ]);

    const extraConvIds = new Set<string>();
    const absorbSnap = (snap: any) => {
      snap.forEach((d: any) => {
        const data = d.data();
        const convId = String(data.conversationId || d.ref.parent?.parent?.id || '');
        const msg = toMsg(d.id, convId, data);
        msgMap.set(msg.id, msg);
        if (convId && !convMap.has(convId)) {
          extraConvIds.add(convId);
        }
      });
    };

    if (sentCg.status === 'fulfilled') absorbSnap(sentCg.value);
    if (recvCg.status === 'fulfilled') absorbSnap(recvCg.value);

    for (const cid of Array.from(extraConvIds)) {
      try {
        const cSnap = await getDoc(doc(db, 'conversations', cid));
        if (cSnap.exists()) {
          convMap.set(cid, toConv(cid, cSnap.data()));
        }
      } catch {
        // Ignore single conversation fetch failure
      }
    }
  } catch {
    // CollectionGroup index may be unindexed in some environments; Step 1 & 2 still succeed
  }

  const conversations = Array.from(convMap.values()).sort(
    (a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
  );
  const messages = Array.from(msgMap.values()).sort(
    (a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)
  );

  return { conversations, messages };
}

export async function adminFetchUserActivityClient(
  userId: string
): Promise<{
  posts: Post[];
  reels: Reel[];
  matchHistory: MatchHistoryRecord[];
}> {
  const now = Date.now();
  const postsList: Post[] = [];
  const reelsList: Reel[] = [];

  try {
    const postsSnap = await getDocs(
      query(collection(db, 'posts'), where('createdAtMs', '>=', 0), limit(150))
    );
    postsSnap.forEach((d) => {
      const data = d.data();
      const unwrapped = unwrapPostMediaFields(data);
      const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
      const createdAtMs = Number(data.createdAtMs || 0);
      if (
        unwrapped.mediaType === 'video' &&
        isVideoContentExpired({
          expiresAt,
          createdAtMs,
          mediaType: unwrapped.mediaType,
          mediaUrls: unwrapped.mediaUrls,
          mediaUrl: unwrapped.mediaUrl,
          videoUrl: unwrapped.videoUrl,
        })
      ) {
        return;
      }
      let comments: any[] = [];
      try {
        const parsed = JSON.parse(data.commentsJson || '[]');
        if (Array.isArray(parsed)) comments = parsed;
      } catch {
        comments = [];
      }
      const hasComment = comments.some(
        (c: any) => c.authorId === userId || (Array.isArray(c.replies) && c.replies.some((r: any) => r.authorId === userId))
      );
      if (data.authorId === userId || hasComment) {
        postsList.push({
          id: String(data.id || d.id),
          authorId: String(data.authorId || ''),
          authorName: String(data.authorName || 'JIT Member'),
          authorAvatar: typeof data.authorAvatar === 'string' ? data.authorAvatar : undefined,
          authorHandle: typeof data.authorHandle === 'string' ? data.authorHandle : undefined,
          content: String(data.content || ''),
          mediaUrls: unwrapped.mediaUrls,
          ...(unwrapped.mediaUrl ? { mediaUrl: unwrapped.mediaUrl } : {}),
          ...(unwrapped.videoUrl ? { videoUrl: unwrapped.videoUrl } : {}),
          mediaType: unwrapped.mediaType,
          thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
          category: (data.category as Post['category']) || 'all',
          likesCount: Number(data.likesCount || 0),
          commentsCount: Number(data.commentsCount || 0),
          sharesCount: Number(data.sharesCount || 0),
          likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
          comments,
          createdAt: String(data.createdAt || 'Just now'),
          createdAtMs,
          expiresAt,
        });
      }
    });
  } catch (err) {
    console.warn('adminFetchUserActivityClient posts notice:', err);
  }

  try {
    const reelsSnap = await getDocs(
      query(collection(db, 'reels'), where('createdAtMs', '>=', 0), limit(100))
    );
    reelsSnap.forEach((d) => {
      const data = d.data();
      const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
      const createdAtMs = Number(data.createdAtMs || 0);
      const rawReelVideoUrl = unwrapSingleMediaString(data.videoUrl || data.mediaUrl || (Array.isArray(data.mediaUrls) ? data.mediaUrls[0] : ''));
      const videoUrl = sanitizeVideoUrl(rawReelVideoUrl) || '';
      if (
        isVideoContentExpired({ expiresAt, createdAtMs, mediaType: 'video', videoUrl })
      ) {
        return;
      }
      if (data.creatorId !== userId) return;
      let comments: any[] = [];
      try {
        const parsed = JSON.parse(data.commentsJson || '[]');
        if (Array.isArray(parsed)) comments = parsed;
      } catch {
        comments = [];
      }
      reelsList.push({
        id: String(data.id || d.id),
        creatorId: String(data.creatorId || ''),
        creatorName: String(data.creatorName || 'JIT Member'),
        creatorAvatar: typeof data.creatorAvatar === 'string' ? data.creatorAvatar : undefined,
        videoUrl,
        mediaUrl: sanitizeVideoUrl(data.mediaUrl),
        thumbnailUrl: typeof data.thumbnailUrl === 'string' && isValidImageUrl(data.thumbnailUrl) ? data.thumbnailUrl : undefined,
        caption: String(data.caption || ''),
        musicTitle: typeof data.musicTitle === 'string' ? data.musicTitle : undefined,
        likesCount: Number(data.likesCount || 0),
        commentsCount: Number(data.commentsCount || 0),
        sharesCount: Number(data.sharesCount || 0),
        viewsCount: Number(data.viewsCount || 1),
        likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
        comments,
        createdAt: String(data.createdAt || 'Just now'),
        createdAtMs: Number(data.createdAtMs || 0),
        expiresAt,
      });
    });
  } catch (err) {
    console.warn('adminFetchUserActivityClient reels notice:', err);
  }

  const matchHistory = await fetchMatchHistory(userId, 40).catch(() => []);
  postsList.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  reelsList.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  return { posts: postsList, reels: reelsList, matchHistory };
}

export async function uploadAnnouncementMediaToCloud(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl?: string;
  expiresAt?: number;
}> {
  const isVideo = file.type.startsWith('video/');
  const mediaId = `ann_med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (isVideo) {
    const expiresAt = Date.now() + VIDEO_EXPIRY_MS;
    const { generateVideoThumbnail } = await import('../services/mediaStorage');
    const thumb = await generateVideoThumbnail(file).catch(() => '');
    const uploaded = await uploadVideoAssetToCloud(
      'usr_jit_admin_system',
      file,
      thumb,
      expiresAt,
      onProgress
    );
    return {
      mediaUrl: uploaded.videoUrl,
      mediaType: 'video',
      thumbnailUrl: uploaded.thumbnailUrl || thumb || undefined,
      expiresAt,
    };
  }

  // Image upload path
  onProgress?.(20);
  const { saveMediaFile } = await import('../services/mediaStorage');
  const { dataUrl } = await saveMediaFile(file);

  try {
    const ext = dataUrl.startsWith('data:image/webp')
      ? 'webp'
      : dataUrl.startsWith('data:image/png')
      ? 'png'
      : 'jpg';
    const imgRef = storageRef(storage, `announcements/${mediaId}.${ext}`);
    const downloadUrl = await Promise.race<string>([
      (async () => {
        await uploadString(imgRef, dataUrl, 'data_url');
        return await getDownloadURL(imgRef);
      })(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Storage announcement image timeout')), 5000)
      ),
    ]);
    if (downloadUrl && downloadUrl.startsWith('http')) {
      onProgress?.(100);
      return { mediaUrl: downloadUrl, mediaType: 'image' };
    }
  } catch {
    // Fall back to compact Data URL (persists directly in Firestore & offline without 404 risk)
  }

  onProgress?.(100);
  return { mediaUrl: dataUrl, mediaType: 'image' };
}

export async function publishFirestoreAnnouncement(ann: GlobalAnnouncement): Promise<void> {
  const createdAtMs = ann.createdAtMs || Date.now();
  const safeMediaUrl =
    ann.mediaUrl && ann.mediaUrl.length <= 740_000 ? ann.mediaUrl : undefined;
  const safeThumb =
    ann.thumbnailUrl && ann.thumbnailUrl.length <= 175_000 ? ann.thumbnailUrl : undefined;

  const payload: Record<string, any> = {
    id: ann.id,
    title: ann.title.slice(0, 140),
    message: ann.message.slice(0, 1000),
    priority: ann.priority || 'important',
    authorName: (ann.authorName || 'JIT GROUP Admin').slice(0, 120),
    ...(safeMediaUrl ? { mediaUrl: safeMediaUrl, mediaType: ann.mediaType || 'image' } : {}),
    ...(safeThumb ? { thumbnailUrl: safeThumb } : {}),
    createdAt: (ann.createdAt || new Date(createdAtMs).toISOString()).slice(0, 40),
    createdAtMs,
    ...(typeof ann.expiresAt === 'number' ? { expiresAt: ann.expiresAt } : {}),
    createdAtTs: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'announcements', ann.id), payload);
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `announcements/${ann.id}`);
    }
    console.warn('publishFirestoreAnnouncement notice:', err);
  }
}

export function subscribeToFirestoreAnnouncements(
  onUpdate: (items: GlobalAnnouncement[]) => void
): Unsubscribe {
  const q = query(collection(db, 'announcements'), where('createdAtMs', '>=', 0), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const now = Date.now();
      const items: GlobalAnnouncement[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const mediaType = (data.mediaType as GlobalAnnouncement['mediaType']) || 'none';
        const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
        const createdAtMs = Number(data.createdAtMs || 0);
        const mediaUrl = typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined;
        if (
          mediaType === 'video' &&
          isVideoContentExpired(
            { expiresAt, createdAtMs, mediaType, mediaUrl },
            { enforceStrictAgeOnly: true }
          ) &&
          !isAccessibleVideoUrl(mediaUrl)
        ) {
          deleteDoc(d.ref).catch(() => {});
          return;
        }
        items.push({
          id: String(data.id || d.id),
          title: String(data.title || 'Announcement'),
          message: String(data.message || ''),
          priority: (data.priority as GlobalAnnouncement['priority']) || 'important',
          authorName: String(data.authorName || 'JIT GROUP Admin'),
          createdAt: String(data.createdAt || new Date().toISOString()),
          createdAtMs: Number(data.createdAtMs || 0),
          mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
          mediaType: mediaType !== 'none' ? mediaType : undefined,
          thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
          expiresAt,
        });
      });
      items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      onUpdate(items);
    },
    (err) => {
      console.warn('announcements onSnapshot notice:', err);
    }
  );
}

export async function deleteFirestoreAnnouncement(id: string): Promise<void> {
  if (!id) return;
  try {
    await deleteDoc(doc(db, 'announcements', id));
  } catch (err) {
    console.warn('deleteFirestoreAnnouncement notice:', err);
  }
}




