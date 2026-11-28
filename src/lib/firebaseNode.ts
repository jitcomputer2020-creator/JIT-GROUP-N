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
  deleteDoc,
  writeBatch,
  collection,
  collectionGroup,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore/lite';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  UserProfile,
  LeaderboardEntry,
  MatchHistoryRecord,
  GameId,
  Conversation,
  Message,
  Post,
  Reel,
  GlobalAnnouncement,
} from '../types';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const dbLite = getFirestore(app);

export const COL = {
  test: 'jitgroup_test',
  profiles: 'jitgroup_profiles',
  users: 'jitgroup_users',
  phoneIndex: 'jitgroup_phone_index',
  leaderboard: 'jitgroup_leaderboard',
  matchHistory: 'jitgroup_match_history',
  userDirectory: 'jitgroup_user_directory',
  conversations: 'jitgroup_conversations',
  chats: 'jitgroup_chats',
  reels: 'jitgroup_reels',
  posts: 'jitgroup_posts',
  announcements: 'jitgroup_announcements',
} as const;

export const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000;

export function normalizeDigitsOnly(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

export function normalizePhone10(phone: string): string {
  let digits = normalizeDigitsOnly(phone);
  if (!digits) return '';
  if (digits.startsWith('00') && digits.length > 10) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('91') && digits.length > 10) {
    digits = digits.slice(2);
  }
  while (digits.startsWith('0') && digits.length > 10) {
    digits = digits.slice(1);
  }
  if (digits.length > 10) {
    digits = digits.slice(-10);
  }
  return digits;
}

export function toCanonicalPhoneKey(phone: string): string {
  return normalizePhone10(phone);
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
  if (url.length > 395000) return '/assets/aistudio/image_e64e54f2.png';
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

const DEFAULT_AVATAR_PATH = '/assets/aistudio/image_e64e54f2.png';

function pickPreferredAvatar(primary?: unknown, secondary?: unknown): string {
  const a = typeof primary === 'string' && primary.trim() ? primary.trim() : '';
  const b = typeof secondary === 'string' && secondary.trim() ? secondary.trim() : '';
  if (a && a !== DEFAULT_AVATAR_PATH) return a;
  if (b && b !== DEFAULT_AVATAR_PATH) return b;
  return a || b || DEFAULT_AVATAR_PATH;
}

function mergeProfileDocs(
  profileDoc: Record<string, any> | null,
  userDoc: Record<string, any> | null,
  fallbackId?: string
): Record<string, any> {
  const p = profileDoc || {};
  const u = userDoc || {};
  const mergedId = String(p.id || u.id || fallbackId || '');
  const mergedStats = {
    ...(u.stats && typeof u.stats === 'object' ? u.stats : {}),
    ...(p.stats && typeof p.stats === 'object' ? p.stats : {}),
  };
  if (mergedStats.rewardPoints === undefined) {
    const rawPts = p.points ?? u.points ?? p.rewardPoints ?? u.rewardPoints;
    if (typeof rawPts === 'number' && Number.isFinite(rawPts)) {
      mergedStats.rewardPoints = rawPts;
    }
  }
  if (mergedStats.friendsCount === undefined) {
    if (Array.isArray(u.friends)) mergedStats.friendsCount = u.friends.length;
    else if (Array.isArray(p.friends)) mergedStats.friendsCount = p.friends.length;
  }
  const mergedAvatar = pickPreferredAvatar(
    p.avatarUrl || p.avatar,
    u.avatarUrl || u.avatar
  );
  const mergedCover =
    (typeof u.coverUrl === 'string' && u.coverUrl) ||
    (typeof u.coverPhoto === 'string' && u.coverPhoto) ||
    (typeof p.coverUrl === 'string' && p.coverUrl) ||
    (typeof p.coverPhoto === 'string' && p.coverPhoto) ||
    '';

  return {
    ...u,
    ...p,
    id: mergedId,
    fullName: p.fullName || p.name || u.fullName || u.name || 'JIT Member',
    contactNumber: p.contactNumber || u.contactNumber || '',
    bio: typeof p.bio === 'string' && p.bio ? p.bio : typeof u.bio === 'string' ? u.bio : '',
    address: p.address || u.address || '',
    avatarUrl: mergedAvatar,
    ...(mergedCover ? { coverUrl: mergedCover } : {}),
    stats: mergedStats,
    lastDailyClaimAt: Math.max(
      Number(p.lastDailyClaimAt || 0),
      Number(u.lastDailyClaimAt || 0)
    ) || undefined,
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

  const fullName = String(data.fullName || data.name || 'JIT Member');
  const contactNumber = String(data.contactNumber || '');
  const rawAvatar =
    typeof data.avatarUrl === 'string' && data.avatarUrl.length > 0
      ? data.avatarUrl
      : typeof data.avatar === 'string' && data.avatar.length > 0
      ? data.avatar
      : DEFAULT_AVATAR_PATH;
  const rawCover =
    typeof data.coverUrl === 'string' && data.coverUrl.length > 0
      ? data.coverUrl
      : typeof data.coverPhoto === 'string' && data.coverPhoto.length > 0
      ? data.coverPhoto
      : undefined;
  const lastDailyClaimAt =
    typeof data.lastDailyClaimAt === 'number' &&
    Number.isFinite(data.lastDailyClaimAt) &&
    data.lastDailyClaimAt > 0
      ? data.lastDailyClaimAt
      : undefined;

  const rawStats = {
    ...(data.stats && typeof data.stats === 'object' ? data.stats : {}),
  };
  if (rawStats.rewardPoints === undefined && typeof data.points === 'number') {
    rawStats.rewardPoints = data.points;
  }
  if (rawStats.friendsCount === undefined && Array.isArray(data.friends)) {
    rawStats.friendsCount = data.friends.length;
  }

  return {
    id: String(data.id),
    contactNumber,
    fullName,
    username: deriveUsername(fullName, contactNumber, typeof data.username === 'string' ? data.username : undefined),
    address: String(data.address || ''),
    bio: typeof data.bio === 'string' ? data.bio : '',
    avatarUrl: rawAvatar,
    coverUrl: rawCover,
    joinedAt: String(data.joinedAt || lastLoginIso),
    lastLoginAt: String(data.lastLoginAt || lastLoginIso),
    lastLogin: String(data.lastLogin || data.lastLoginAt || lastLoginIso),
    isContactNumberPublic: Boolean(data.isContactNumberPublic),
    isAddressPublic: Boolean(data.isAddressPublic),
    status: (data.status as UserProfile['status']) || 'active',
    suspendedReason: typeof data.suspendedReason === 'string' && data.suspendedReason ? data.suspendedReason : undefined,
    suspendedAt: typeof data.suspendedAt === 'string' && data.suspendedAt ? data.suspendedAt : undefined,
    ...(lastDailyClaimAt ? { lastDailyClaimAt } : {}),
    stats: sanitizeStats(rawStats),
  };
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDoc(doc(dbLite, COL.test, 'connection'));
  } catch {
    // Non-fatal connection probe
  }
}

async function cleanupExpiredCloudProfile(phoneKey: string, profileId: string): Promise<void> {
  try {
    const batch = writeBatch(dbLite);
    batch.delete(doc(dbLite, COL.phoneIndex, phoneKey));
    batch.delete(doc(dbLite, COL.profiles, profileId));
    await batch.commit();
  } catch (err) {
    console.warn('Expired profile cloud cleanup notice:', err);
  }
}

export async function lookupCloudProfileByPhone(
  contactNumber: string
): Promise<{ found: boolean; profile?: UserProfile; expired?: boolean }> {
  const rawDigits = normalizeDigitsOnly(contactNumber);
  const phoneKey = toCanonicalPhoneKey(contactNumber);
  if (!phoneKey || phoneKey.length < 7) return { found: false };

  let profileData: Record<string, any> | null = null;
  let userData: Record<string, any> | null = null;
  let profileId: string | null = null;

  const keysToTry = Array.from(
    new Set([phoneKey, rawDigits, `91${phoneKey}`, `0${phoneKey}`].filter((k) => k && k.length >= 7))
  );
  for (const keyCandidate of keysToTry) {
    const indexSnap = await getDoc(doc(dbLite, COL.phoneIndex, keyCandidate)).catch(() => null);
    if (!indexSnap || !indexSnap.exists()) continue;
    const indexData = indexSnap.data();
    const pid = indexData?.profileId;
    if (!pid || typeof pid !== 'string') continue;

    if (isCloudTimestampExpired(indexData.lastLoginAt)) {
      await cleanupExpiredCloudProfile(keyCandidate, pid);
      return { found: false, expired: true };
    }

    const [profileSnap, userSnap] = await Promise.all([
      getDoc(doc(dbLite, COL.profiles, pid)).catch(() => null),
      getDoc(doc(dbLite, COL.users, pid)).catch(() => null),
    ]);
    const candidateProfile = profileSnap && profileSnap.exists() ? profileSnap.data() : null;
    const candidateUser = userSnap && userSnap.exists() ? userSnap.data() : null;
    if (
      (candidateProfile && candidateProfile.status !== 'deleted') ||
      (candidateUser && candidateUser.status !== 'deleted')
    ) {
      profileId = pid;
      profileData = candidateProfile && candidateProfile.status !== 'deleted' ? candidateProfile : null;
      userData = candidateUser && candidateUser.status !== 'deleted' ? candidateUser : null;
      break;
    }
  }

  if (!profileData && !userData) {
    for (const colName of [COL.users, COL.profiles]) {
      try {
        const keySnap = await getDocs(
          query(collection(dbLite, colName), where('phoneKey', '==', phoneKey), limit(10))
        );
        for (const d of keySnap.docs) {
          const data = d.data();
          if (data && data.status !== 'deleted') {
            profileId = String(data.id || d.id);
            if (colName === COL.users) userData = data;
            else profileData = data;
            break;
          }
        }
        if (profileId) break;
      } catch {
        // Fallback to bounded scan
      }
    }
  }

  if (!profileData && !userData) {
    for (const colName of [COL.users, COL.profiles]) {
      try {
        const scanSnap = await getDocs(query(collection(dbLite, colName), limit(350)));
        for (const d of scanSnap.docs) {
          const data = d.data();
          if (!data || data.status === 'deleted') continue;
          const storedKey = normalizePhone10(String(data.phoneKey || data.contactNumber || ''));
          if (storedKey && storedKey === phoneKey) {
            profileId = String(data.id || d.id);
            if (colName === COL.users) userData = data;
            else profileData = data;
            break;
          }
        }
        if (profileId) break;
      } catch {
        // ignore
      }
    }
  }

  if ((!profileData && !userData) || !profileId) return { found: false };

  if (!profileData) {
    const profileSnap = await getDoc(doc(dbLite, COL.profiles, profileId)).catch(() => null);
    if (profileSnap && profileSnap.exists() && profileSnap.data()?.status !== 'deleted') {
      profileData = profileSnap.data();
    }
  }
  if (!userData) {
    const userSnap = await getDoc(doc(dbLite, COL.users, profileId)).catch(() => null);
    if (userSnap && userSnap.exists() && userSnap.data()?.status !== 'deleted') {
      userData = userSnap.data();
    }
  }

  const mergedDoc = mergeProfileDocs(profileData, userData, profileId);

  if (
    profileId !== 'usr_jit_primary_001' &&
    isCloudTimestampExpired(mergedDoc.lastActiveAt, mergedDoc.lastLoginAt || mergedDoc.lastLogin)
  ) {
    await cleanupExpiredCloudProfile(phoneKey, profileId);
    return { found: false, expired: true };
  }

  return { found: true, profile: firestoreDocToUserProfile(mergedDoc) };
}

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

  // Strictly READ-only on login so existing Firestore user data & custom photos are never overwritten.
  return {
    success: true,
    profile,
  };
}

export async function syncNodeLeaderboardEntry(profile: UserProfile, lastGameId?: string): Promise<void> {
  if (!profile?.id) return;
  try {
    const stats = sanitizeStats(profile.stats);
    await setDoc(doc(dbLite, COL.leaderboard, profile.id), {
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
    // Strictly preserve existing user profile data & photos without overwriting Firestore
    return { success: true, isExisting: true, profile: existing.profile };
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
    stats: sanitizeStats(seedProfile?.stats || { rewardPoints: 100, streakDays: 1 }),
  };

  const firestoreProfileDoc: Record<string, any> = {
    id: newProfile.id,
    contactNumber: newProfile.contactNumber,
    phoneKey,
    fullName: newProfile.fullName,
    name: newProfile.fullName,
    username: derivedUsername,
    address: newProfile.address,
    bio: newProfile.bio || '',
    avatarUrl: newProfile.avatarUrl,
    avatar: newProfile.avatarUrl,
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
    firestoreProfileDoc.coverPhoto = newProfile.coverUrl;
  }

  const batch = writeBatch(dbLite);
  batch.set(doc(dbLite, COL.profiles, newProfile.id), firestoreProfileDoc, { merge: true });
  batch.set(doc(dbLite, COL.users, newProfile.id), firestoreProfileDoc, { merge: true });
  batch.set(doc(dbLite, COL.phoneIndex, phoneKey), {
    profileId: newProfile.id,
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(dbLite, COL.leaderboard, newProfile.id), {
    profileId: newProfile.id,
    fullName: newProfile.fullName,
    avatarUrl: newProfile.avatarUrl,
    rewardPoints: newProfile.stats.rewardPoints,
    gamesPlayed: newProfile.stats.gamesPlayed,
    gamesWon: newProfile.stats.gamesWon,
    streakDays: newProfile.stats.streakDays,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(dbLite, COL.userDirectory, newProfile.id), buildUserDirectoryPayload(newProfile));
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
  const profileRef = doc(dbLite, COL.profiles, profile.id);
  const userRef = doc(dbLite, COL.users, profile.id);
  const indexRef = doc(dbLite, COL.phoneIndex, phoneKey);

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
    return;
  }

  const patch: Record<string, any> = {
    id: profile.id,
    contactNumber: profile.contactNumber,
    phoneKey,
    lastLoginAt: nowIso,
    lastLogin: nowIso,
    lastActiveAt: serverTimestamp(),
  };

  if (updates.fullName !== undefined) {
    const cleanName = updates.fullName.trim().slice(0, 120);
    patch.fullName = cleanName;
    patch.name = cleanName;
  }
  if (updates.username !== undefined) {
    patch.username = deriveUsername(
      updates.fullName || profile.fullName,
      profile.contactNumber,
      updates.username
    );
  }
  if (updates.bio !== undefined) patch.bio = updates.bio.slice(0, 500);
  if (updates.address !== undefined) patch.address = updates.address.trim().slice(0, 300);
  if (updates.avatarUrl !== undefined) {
    const cleanAvatar = sanitizeAvatarUrl(updates.avatarUrl);
    patch.avatarUrl = cleanAvatar;
    patch.avatar = cleanAvatar;
  }
  if (updates.coverUrl !== undefined) {
    if (updates.coverUrl === '') {
      patch.coverUrl = '';
      patch.coverPhoto = '';
    } else if (updates.coverUrl.length <= 395000) {
      patch.coverUrl = updates.coverUrl;
      patch.coverPhoto = updates.coverUrl;
    }
  }
  if (updates.isContactNumberPublic !== undefined) {
    patch.isContactNumberPublic = Boolean(updates.isContactNumberPublic);
  }
  if (updates.isAddressPublic !== undefined) {
    patch.isAddressPublic = Boolean(updates.isAddressPublic);
  }
  if (hasStatsUpdate) {
    patch.stats = sanitizeStats(updates.stats || profile.stats);
  }
  if (hasClaimUpdate) {
    patch.lastDailyClaimAt = updates.lastDailyClaimAt;
  }

  const mergedProfile: UserProfile = {
    ...profile,
    ...updates,
    ...(patch.username ? { username: patch.username } : {}),
    stats: sanitizeStats(updates.stats || profile.stats),
  };
  const batch = writeBatch(dbLite);
  batch.set(profileRef, patch, { merge: true });
  batch.set(userRef, patch, { merge: true });
  batch.set(indexRef, { profileId: profile.id, lastLoginAt: serverTimestamp() }, { merge: true });
  batch.set(doc(dbLite, COL.userDirectory, profile.id), buildUserDirectoryPayload(mergedProfile), { merge: true });
  await batch.commit();

  await syncNodeLeaderboardEntry(mergedProfile);
}

export async function ensureCloudProfileSeeded(profile: UserProfile): Promise<void> {
  const phoneKey = toCanonicalPhoneKey(profile.contactNumber);
  if (!phoneKey || phoneKey.length < 7) return;
  try {
    const existing = await getDoc(doc(dbLite, COL.phoneIndex, phoneKey));
    if (!existing.exists()) {
      await registerOrRecognizeCloudProfile(
        profile.contactNumber,
        profile.fullName,
        profile.address,
        profile
      );
    } else {
      const lbSnap = await getDoc(doc(dbLite, COL.leaderboard, profile.id));
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
      collection(dbLite, COL.leaderboard),
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
  } catch (err) {
    console.warn('Leaderboard fetch notice (node):', err);
    return [];
  }
}

export async function fetchNodeMatchHistory(profileId?: string, maxEntries = 20): Promise<MatchHistoryRecord[]> {
  try {
    const colRef = collection(dbLite, COL.matchHistory);
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
  } catch {
    return [];
  }
}

/**
 * Discovers and fetches all active Firebase user profiles via leaderboard index + single-doc profile reads,
 * merged with local mirror profiles for complete administrative visibility.
 */
export async function fetchAllCloudProfilesForAdmin(
  localMirrorProfiles: UserProfile[] = []
): Promise<{ profiles: Array<UserProfile & { source: 'firebase' | 'local-mirror' }>; firebaseCount: number }> {
  const leaderboardEntries = await fetchNodeLeaderboard(500);
  const discoveredIds = new Set<string>();

  for (const entry of leaderboardEntries) {
    if (entry.profileId) {
      discoveredIds.add(entry.profileId);
    }
  }

  for (const local of localMirrorProfiles) {
    if (local?.id) {
      discoveredIds.add(local.id);
    }
  }

  const profileMap = new Map<string, UserProfile & { source: 'firebase' | 'local-mirror' }>();
  let firebaseCount = 0;

  const ids = Array.from(discoveredIds);
  const CONCURRENCY = 12;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const chunk = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (profileId) => {
        try {
          const snap = await getDoc(doc(dbLite, COL.profiles, profileId));
          if (snap.exists()) {
            const data = snap.data();
            if (data.status === 'deleted') {
              return null;
            }
            if (
              profileId !== 'usr_jit_primary_001' &&
              isCloudTimestampExpired(data.lastActiveAt, data.lastLoginAt || data.lastLogin)
            ) {
              return null;
            }
            return { ...firestoreDocToUserProfile(data), source: 'firebase' as const };
          }
        } catch {
          // Ignore single read failure
        }
        return null;
      })
    );
    for (const item of results) {
      if (item) {
        profileMap.set(item.id, item);
        firebaseCount++;
      }
    }
  }

  // Fallback check via phone_index for any local profiles whose ID might differ
  for (const local of localMirrorProfiles) {
    if (!local || local.status === 'deleted' || profileMap.has(local.id)) continue;
    const phoneKey = toCanonicalPhoneKey(local.contactNumber);
    const existingByPhone = Array.from(profileMap.values()).find(
      (p) => toCanonicalPhoneKey(p.contactNumber) === phoneKey
    );
    if (existingByPhone) continue;

    try {
      const lookup = await lookupCloudProfileByPhone(local.contactNumber);
      if (lookup.found && lookup.profile) {
        profileMap.set(lookup.profile.id, { ...lookup.profile, source: 'firebase' });
        firebaseCount++;
        continue;
      }
    } catch {
      // Fallback to local mirror entry
    }

    profileMap.set(local.id, { ...local, source: 'local-mirror' });
  }

  // Ensure any leaderboard-only user without a readable profile doc is still represented
  for (const entry of leaderboardEntries) {
    if (!profileMap.has(entry.profileId)) {
      try {
        const deletedCheck = await getDoc(doc(dbLite, COL.profiles, entry.profileId));
        if (deletedCheck.exists() && deletedCheck.data()?.status === 'deleted') {
          continue;
        }
      } catch {
        // Ignore
      }
      const nowIso = new Date().toISOString();
      profileMap.set(entry.profileId, {
        id: entry.profileId,
        contactNumber: 'Hidden / Unlinked',
        fullName: entry.fullName,
        address: '',
        avatarUrl: entry.avatarUrl,
        joinedAt: entry.updatedAt || nowIso,
        lastLoginAt: entry.updatedAt || nowIso,
        lastLogin: entry.updatedAt || nowIso,
        status: 'active',
        stats: {
          friendsCount: 0,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0,
          reelsCount: 0,
          gamesPlayed: entry.gamesPlayed,
          gamesWon: entry.gamesWon,
          rewardPoints: entry.rewardPoints,
          streakDays: entry.streakDays,
        },
        source: 'firebase',
      });
      firebaseCount++;
    }
  }

  const profiles = Array.from(profileMap.values()).sort(
    (a, b) => new Date(b.joinedAt || 0).getTime() - new Date(a.joinedAt || 0).getTime()
  );

  return { profiles, firebaseCount };
}

/**
 * Admin direct override for profile fields (name, username, status, bio, photos) and JIT Points balance in Firestore.
 */
export async function adminOverrideCloudProfile(
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

  const profileRef = doc(dbLite, COL.profiles, baseProfile.id);
  const snap = await getDoc(profileRef);
  if (snap.exists()) {
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
      deleteDoc(doc(dbLite, COL.leaderboard, baseProfile.id)),
      deleteDoc(doc(dbLite, COL.userDirectory, baseProfile.id)),
    ]);
  } else {
    await Promise.allSettled([
      syncNodeLeaderboardEntry(nextProfile),
      setDoc(doc(dbLite, COL.userDirectory, nextProfile.id), buildUserDirectoryPayload(nextProfile)),
    ]);
  }

  return nextProfile;
}

/**
 * Admin moderation action (suspend / unblock / delete) synced to Firestore.
 */
export async function adminModerateCloudProfile(
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

  const profileRef = doc(dbLite, COL.profiles, profile.id);
  const snap = await getDoc(profileRef);
  if (snap.exists()) {
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
      deleteDoc(doc(dbLite, COL.leaderboard, profile.id)),
      deleteDoc(doc(dbLite, COL.userDirectory, profile.id)),
    ]);
  }

  return {
    ...profile,
    status: nextStatus,
    suspendedReason: cleanReason || undefined,
    suspendedAt: suspendedAt || undefined,
    lastLoginAt: nowIso,
    lastLogin: nowIso,
  };
}

function parseNodeParticipantsMap(jsonStr?: string): Record<string, { name: string; avatar?: string }> {
  try {
    const parsed = JSON.parse(jsonStr || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function fetchNodeUserActivity(userId: string): Promise<{
  conversations: Conversation[];
  messages: Array<Message & { createdAtMs?: number }>;
  posts: Post[];
  reels: Reel[];
  matchHistory: MatchHistoryRecord[];
}> {
  const convMap = new Map<string, Conversation>();
  const msgMap = new Map<string, Message & { createdAtMs?: number }>();
  const now = Date.now();

  const toConv = (id: string, data: Record<string, any>): Conversation => {
    const participantIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
    const pMap = parseNodeParticipantsMap(data.participantsJson);
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

  const toMsg = (id: string, fallbackConvId: string, data: Record<string, any>): Message & { createdAtMs?: number } => ({
    id: String(data.id || id),
    conversationId: String(data.conversationId || fallbackConvId),
    senderId: String(data.senderId || ''),
    receiverId: typeof data.receiverId === 'string' ? data.receiverId : undefined,
    senderName: String(data.senderName || 'JIT Member'),
    senderAvatar: typeof data.senderAvatar === 'string' ? data.senderAvatar : undefined,
    content: String(data.content || ''),
    mediaUrl: typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined,
    mediaType: data.mediaType as Message['mediaType'],
    createdAt: String(data.createdAt || ''),
    createdAtMs: Number(data.createdAtMs || 0),
    status: (data.status as Message['status']) || 'delivered',
  });

  // 1. Conversations matching participantIds + recent threads scan
  const [partRes, recentRes] = await Promise.allSettled([
    getDocs(query(collection(dbLite, COL.conversations), where('participantIds', 'array-contains', userId), limit(100))),
    getDocs(query(collection(dbLite, COL.conversations), limit(100))),
  ]);

  if (partRes.status === 'fulfilled') {
    partRes.value.forEach((d) => {
      const conv = toConv(d.id, d.data());
      convMap.set(conv.id, conv);
    });
  }
  if (recentRes.status === 'fulfilled') {
    recentRes.value.forEach((d) => {
      const data = d.data();
      const participantIds: string[] = Array.isArray(data.participantIds) ? data.participantIds : [];
      const pMap = parseNodeParticipantsMap(data.participantsJson);
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

  // 2. Fetch messages inside matched conversations
  const convIds = Array.from(convMap.keys());
  for (let i = 0; i < convIds.length; i += 10) {
    const slice = convIds.slice(i, i + 10);
    await Promise.all(
      slice.map(async (cid) => {
        try {
          const snap = await getDocs(
            query(collection(dbLite, COL.conversations, cid, 'messages'), where('createdAtMs', '>=', 0), limit(200))
          );
          snap.forEach((d) => {
            const msg = toMsg(d.id, cid, d.data());
            msgMap.set(msg.id, msg);
          });
        } catch {
          // ignore
        }
      })
    );
  }

  // 3. CollectionGroup query for senderId == userId or receiverId == userId
  try {
    const [sentCg, recvCg] = await Promise.allSettled([
      getDocs(query(collectionGroup(dbLite, 'messages'), where('senderId', '==', userId), limit(200))),
      getDocs(query(collectionGroup(dbLite, 'messages'), where('receiverId', '==', userId), limit(200))),
    ]);
    const extraConvIds = new Set<string>();
    const absorb = (snap: any) => {
      snap.forEach((d: any) => {
        const data = d.data();
        const convId = String(data.conversationId || d.ref.parent?.parent?.id || '');
        const msg = toMsg(d.id, convId, data);
        msgMap.set(msg.id, msg);
        if (convId && !convMap.has(convId)) extraConvIds.add(convId);
      });
    };
    if (sentCg.status === 'fulfilled') absorb(sentCg.value);
    if (recvCg.status === 'fulfilled') absorb(recvCg.value);

    for (const cid of Array.from(extraConvIds)) {
      try {
        const cSnap = await getDoc(doc(dbLite, COL.conversations, cid));
        if (cSnap.exists()) {
          convMap.set(cid, toConv(cid, cSnap.data()));
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // CollectionGroup index optional
  }

  // 4. Posts & Reels authored/interacted by user in Firestore
  const postsList: Post[] = [];
  const reelsList: Reel[] = [];

  try {
    const postsSnap = await getDocs(query(collection(dbLite, COL.posts), where('createdAtMs', '>=', 0), limit(150)));
    postsSnap.forEach((d) => {
      const data = d.data();
      const mediaType = (data.mediaType as Post['mediaType']) || 'none';
      const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
      if (mediaType === 'video' && expiresAt !== undefined && expiresAt <= now) return;
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
          mediaUrls: Array.isArray(data.mediaUrls) ? data.mediaUrls : undefined,
          mediaType,
          thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
          category: (data.category as Post['category']) || 'all',
          likesCount: Number(data.likesCount || 0),
          commentsCount: Number(data.commentsCount || 0),
          sharesCount: Number(data.sharesCount || 0),
          likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
          comments,
          createdAt: String(data.createdAt || 'Just now'),
          createdAtMs: Number(data.createdAtMs || 0),
          expiresAt,
        });
      }
    });
  } catch {
    // non-fatal
  }

  try {
    const reelsSnap = await getDocs(query(collection(dbLite, COL.reels), where('createdAtMs', '>=', 0), limit(100)));
    reelsSnap.forEach((d) => {
      const data = d.data();
      const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
      if (expiresAt !== undefined && expiresAt <= now) return;
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
        videoUrl: String(data.videoUrl || ''),
        thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : undefined,
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
  } catch {
    // non-fatal
  }

  const matchHistory = await fetchNodeMatchHistory(userId, 40).catch(() => []);

  return {
    conversations: Array.from(convMap.values()).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)),
    messages: Array.from(msgMap.values()).sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)),
    posts: postsList.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    reels: reelsList.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    matchHistory,
  };
}

export async function fetchNodePlatformCounts(): Promise<{
  postsCount: number;
  conversationsCount: number;
  announcementsCount: number;
}> {
  const [postsRes, convRes, annRes] = await Promise.allSettled([
    getDocs(query(collection(dbLite, COL.posts), where('createdAtMs', '>=', 0), limit(200))),
    getDocs(query(collection(dbLite, COL.conversations), limit(100))),
    getDocs(query(collection(dbLite, COL.announcements), where('createdAtMs', '>=', 0), limit(50))),
  ]);
  return {
    postsCount: postsRes.status === 'fulfilled' ? postsRes.value.size : 0,
    conversationsCount: convRes.status === 'fulfilled' ? convRes.value.size : 0,
    announcementsCount: annRes.status === 'fulfilled' ? annRes.value.size : 0,
  };
}

export async function deleteNodePost(postId: string): Promise<void> {
  if (!postId) return;
  await deleteDoc(doc(dbLite, COL.posts, postId));
}

export async function deleteNodeReel(reelId: string): Promise<void> {
  if (!reelId) return;
  await deleteDoc(doc(dbLite, COL.reels, reelId));
}

export async function deleteNodeMatchRecord(matchId: string): Promise<void> {
  if (!matchId) return;
  await deleteDoc(doc(dbLite, COL.matchHistory, matchId));
}

export async function publishNodeAnnouncement(ann: GlobalAnnouncement, feedPost?: Post): Promise<void> {
  const createdAtMs = ann.createdAtMs || Date.now();
  const safeMediaUrl = ann.mediaUrl && ann.mediaUrl.length <= 740_000 ? ann.mediaUrl : undefined;
  const safeThumb = ann.thumbnailUrl && ann.thumbnailUrl.length <= 175_000 ? ann.thumbnailUrl : undefined;

  await setDoc(doc(dbLite, COL.announcements, ann.id), {
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
  });

  if (feedPost) {
    const safeFeedUrls = Array.isArray(feedPost.mediaUrls)
      ? feedPost.mediaUrls.filter((u) => typeof u === 'string' && u.length <= 740_000).slice(0, 4)
      : undefined;
    await setDoc(doc(dbLite, COL.posts, feedPost.id), {
      id: feedPost.id,
      authorId: feedPost.authorId,
      authorName: feedPost.authorName.slice(0, 120),
      authorAvatar: sanitizeAvatarUrl(feedPost.authorAvatar),
      authorHandle: (feedPost.authorHandle || '@jit_announcement').slice(0, 80),
      content: feedPost.content.slice(0, 5000),
      ...(safeFeedUrls && safeFeedUrls.length > 0 ? { mediaUrls: safeFeedUrls } : {}),
      mediaType: feedPost.mediaType || 'none',
      ...(safeThumb ? { thumbnailUrl: safeThumb } : {}),
      category: 'all',
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      likedBy: [],
      commentsJson: '[]',
      createdAt: 'Just now',
      createdAtMs,
      ...(typeof feedPost.expiresAt === 'number' ? { expiresAt: feedPost.expiresAt } : {}),
      createdAtTs: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function fetchNodeAnnouncements(): Promise<GlobalAnnouncement[]> {
  try {
    const snap = await getDocs(query(collection(dbLite, COL.announcements), where('createdAtMs', '>=', 0), limit(50)));
    const now = Date.now();
    const list: GlobalAnnouncement[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const mediaType = (data.mediaType as GlobalAnnouncement['mediaType']) || 'none';
      const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : undefined;
      if (mediaType === 'video' && expiresAt !== undefined && expiresAt <= now) return;
      list.push({
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
    return list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  } catch {
    return [];
  }
}

export async function deleteNodeAnnouncement(id: string): Promise<void> {
  if (!id) return;
  await Promise.allSettled([
    deleteDoc(doc(dbLite, COL.announcements, id)),
    deleteDoc(doc(dbLite, COL.posts, `post_ann_${id}`)),
  ]);
}

