/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Centralized Social Context
 * Coordinates posts, stories, reels, comments, likes, friendships, notifications,
 * DM partner routing, and 40-day video expiration with Firebase Firestore real-time sync.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Post,
  Story,
  Reel,
  Comment,
  UserProfile,
  GlobalAnnouncement,
  InAppNotification,
  FriendRequest,
} from '../types';
import {
  INITIAL_POSTS,
  INITIAL_STORIES,
  INITIAL_REELS,
  INITIAL_FRIENDS,
  INITIAL_USER,
  INITIAL_NOTIFICATIONS,
} from '../services/mockData';
import { useAuth } from './AuthContext';
import { APP_CONFIG } from '../constants/branding';
import { purgeExpiredLocalMedia } from '../services/mediaStorage';
import { detectExpressBackendAvailable, safeFetchJson } from '../utils/safeFetch';
import {
  isPlaceholderOrInvalidMediaString,
  isValidImageUrl,
  isValidVideoUrl,
  sanitizeVideoUrl,
} from '../lib/mediaValidation';
import {
  VIDEO_EXPIRY_MS,
  deriveUsername,
  isVideoContentExpired,
  sendFirestoreFriendRequest,
  respondToFirestoreFriendRequest,
  removeFirestoreFriendship,
  subscribeToFirestoreFriendRequests,
  subscribeToFirestoreNotifications,
  markFirestoreNotificationRead,
  markAllFirestoreNotificationsRead,
  publishFirestoreReel,
  subscribeToFirestoreReels,
  updateFirestoreReelInteraction,
  publishFirestorePost,
  subscribeToFirestorePosts,
  updateFirestorePostInteraction,
  deleteFirestorePost,
  deleteFirestoreReel,
  purgeExpiredCloudVideos,
  subscribeToFirestoreAnnouncements,
} from '../lib/firebase';

export interface ActiveChatPartner {
  id: string;
  fullName?: string;
  avatarUrl?: string;
}

export interface PendingGameInvite {
  roomId: string;
  gameId?: string;
  requestedAt: number;
}

interface SocialContextType {
  posts: Post[];
  stories: Story[];
  reels: Reel[];
  announcements: GlobalAnnouncement[];
  notifications: InAppNotification[];
  unreadNotificationCount: number;
  friendRequestPeers: UserProfile[];
  activeChatPartner: ActiveChatPartner | null;
  openDirectChat: (partner: ActiveChatPartner) => void;
  clearActiveChatPartner: () => void;
  pendingGameInvite: PendingGameInvite | null;
  joinInvitedGameRoom: (roomId: string, gameId?: string) => void;
  clearPendingGameInvite: () => void;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  refreshAnnouncements: () => Promise<void>;
  savedPostIds: string[];
  friendIds: string[];
  pendingIncomingRequestIds: string[];
  pendingOutgoingRequestIds: string[];
  viewingUserId: string | null;
  setViewingUserId: (id: string | null) => void;
  createPost: (params: {
    content: string;
    mediaUrls?: string[];
    mediaType?: 'image' | 'video' | 'none';
    thumbnailUrl?: string;
    createdAtMs?: number;
    expiresAt?: number;
    category?: 'all' | 'friends' | 'following' | 'popular';
  }) => void;
  editPost: (
    postId: string,
    content: string,
    mediaUrls?: string[],
    mediaType?: 'image' | 'video' | 'none'
  ) => void;
  deletePost: (postId: string) => void;
  toggleLikePost: (postId: string) => void;
  getPostLikers: (postId: string) => UserProfile[];
  addComment: (postId: string, content: string, parentCommentId?: string) => void;
  toggleSavePost: (postId: string) => void;
  addStory: (params: { mediaUrl: string; mediaType: 'image' | 'video'; caption?: string }) => void;
  deleteStory: (storyId: string) => void;
  addReel: (params: {
    videoUrl: string;
    thumbnailUrl?: string;
    caption: string;
    musicTitle?: string;
    createdAtMs?: number;
    expiresAt?: number;
  }) => void;
  deleteReel: (reelId: string) => void;
  toggleLikeReel: (reelId: string) => void;
  addReelComment: (reelId: string, content: string) => void;
  sendFriendRequest: (userId: string, targetProfile?: Partial<UserProfile>) => void;
  acceptFriendRequest: (userId: string) => void;
  rejectFriendRequest: (userId: string) => void;
  removeFriend: (userId: string) => void;
  isFriend: (userId: string) => boolean;
  hasPendingOutgoing: (userId: string) => boolean;
  hasPendingIncoming: (userId: string) => boolean;
}

const SocialContext = createContext<SocialContextType | undefined>(undefined);

const LS_POSTS = 'jit_posts_store_v2';
const LS_STORIES = 'jit_stories_store_v2';
const LS_REELS = 'jit_reels_store_v2';
const LS_SAVED_POSTS = 'jit_saved_posts_v2';
const LS_FRIENDS = 'jit_friends_store_v2';
const LS_PENDING_OUT = 'jit_pending_outgoing_v2';
const LS_PENDING_IN = 'jit_pending_incoming_v2';
const LS_REMOVED_DEMO_FRIENDS = 'jit_removed_demo_friends_v1';

function safeSetLocalStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 2_500_000) return;
    localStorage.setItem(key, serialized);
  } catch {
    // Prevent QuotaExceededError from crashing React during large video uploads
  }
}

function sanitizePostRecordMedia(p: Post): Post {
  const validMediaUrls = p.mediaUrls?.filter(
    (u) =>
      typeof u === 'string' &&
      !isPlaceholderOrInvalidMediaString(u) &&
      (isValidVideoUrl(u) || isValidImageUrl(u)) &&
      !(u.startsWith('data:video/') && u.length > 250_000)
  );
  const safeVideoUrl = sanitizeVideoUrl(p.videoUrl);
  const safeMediaUrl =
    p.mediaUrl && !isPlaceholderOrInvalidMediaString(p.mediaUrl) && (isValidVideoUrl(p.mediaUrl) || isValidImageUrl(p.mediaUrl))
      ? p.mediaUrl
      : undefined;
  const hasAnyMedia = Boolean(
    (validMediaUrls && validMediaUrls.length > 0) || safeVideoUrl || safeMediaUrl
  );
  return {
    ...p,
    mediaUrls: validMediaUrls && validMediaUrls.length > 0 ? validMediaUrls : undefined,
    videoUrl: safeVideoUrl,
    mediaUrl: safeMediaUrl,
    mediaType: hasAnyMedia ? p.mediaType : 'none',
  };
}

function sanitizePostsForCache(list: Post[]): Post[] {
  return list
    .filter((p) => !isVideoContentExpired(p))
    .slice(0, 60)
    .map(sanitizePostRecordMedia);
}

function sanitizeReelsForCache(list: Reel[]): Reel[] {
  return list
    .filter((r) => !isVideoContentExpired(r))
    .slice(0, 50)
    .map((r) => {
      const cleanUrl = sanitizeVideoUrl(r.videoUrl) || '';
      return {
        ...r,
        videoUrl:
          cleanUrl.startsWith('data:video/') && cleanUrl.length > 250_000
            ? ''
            : cleanUrl,
      };
    });
}

const SEED_COMMENTS: Record<string, Comment[]> = {
  post_001: [
    {
      id: 'comm_001',
      postId: 'post_001',
      authorId: 'usr_jit_002',
      authorName: 'Priya Mukherjee',
      authorAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80',
      content: 'Looking forward to the Chess Blitz championship, Professor!',
      createdAt: '1 hour ago',
      likesCount: 3,
      replies: [
        {
          id: 'reply_001',
          postId: 'post_001',
          parentId: 'comm_001',
          authorId: 'usr_jit_primary_001',
          authorName: 'Prof. Ramesh Sharma',
          authorAvatar: '/assets/aistudio/image_e64e54f2.png',
          content: 'Make sure to bring your A-game, Priya! The trophies have arrived.',
          createdAt: '45m ago',
          likesCount: 2,
        },
      ],
    },
    {
      id: 'comm_002',
      postId: 'post_001',
      authorId: 'usr_jit_003',
      authorName: 'Arjun Verma',
      authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80',
      content: 'Ludo room bracket is filled up. This is going to be epic!',
      createdAt: '30m ago',
      likesCount: 1,
    },
  ],
  post_002: [
    {
      id: 'comm_003',
      postId: 'post_002',
      authorId: 'usr_jit_004',
      authorName: 'Ananya Sen',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      content: 'Joining the Snake & Ladder room right now!',
      createdAt: '2 hours ago',
      likesCount: 2,
    },
  ],
};

const SEED_POSTS: Post[] = INITIAL_POSTS.map((p) => ({
  ...p,
  likedBy: p.isLiked ? ['usr_jit_primary_001', 'usr_jit_002', 'usr_jit_003'] : ['usr_jit_002', 'usr_jit_004'],
  comments: SEED_COMMENTS[p.id] || [],
}));

const SEED_REELS: Reel[] = INITIAL_REELS.map((r) => ({
  ...r,
  likedBy: r.isLiked ? ['usr_jit_primary_001', 'usr_jit_003'] : ['usr_jit_002'],
  comments: [
    {
      id: `rc_${r.id}_1`,
      postId: r.id,
      authorId: 'usr_jit_004',
      authorName: 'Ananya Sen',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      content: 'Awesome gameplay highlight! 🔥',
      createdAt: '1h ago',
      likesCount: 4,
    },
  ],
}));

export const SocialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, registeredProfiles } = useAuth();
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<GlobalAnnouncement[]>([]);
  const [activeChatPartner, setActiveChatPartner] = useState<ActiveChatPartner | null>(null);
  const [pendingGameInvite, setPendingGameInvite] = useState<PendingGameInvite | null>(null);
  const [cloudNotifications, setCloudNotifications] = useState<InAppNotification[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const postsHydratedRef = useRef(false);
  const deletedPostIdsRef = useRef<Set<string>>(new Set());
  const deletedReelIdsRef = useRef<Set<string>>(new Set());
  const cloudPostIdsSeenRef = useRef<Set<string>>(new Set());
  const cloudReelIdsSeenRef = useRef<Set<string>>(new Set());
  const [cloudAnnouncements, setCloudAnnouncements] = useState<GlobalAnnouncement[]>([]);
  const [serverAnnouncements, setServerAnnouncements] = useState<GlobalAnnouncement[]>([]);

  const isPrimaryDemoUser = currentUser?.id === 'usr_jit_primary_001';

  // 1. Posts state (filtered by 40-day expiry)
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_POSTS);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Post[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.filter((p) => !isVideoContentExpired(p)).map(sanitizePostRecordMedia);
          }
        } catch (e) {
          console.error('Failed to parse cached posts', e);
        }
      }
    }
    return SEED_POSTS;
  });

  // 2. Stories state
  const [stories, setStories] = useState<Story[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_STORIES);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse cached stories', e);
        }
      }
    }
    return INITIAL_STORIES;
  });

  // 3. Reels state (filtered by 40-day expiry)
  const [reels, setReels] = useState<Reel[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_REELS);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Reel[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed
              .filter((r) => !isVideoContentExpired(r))
              .map((r) => ({ ...r, videoUrl: sanitizeVideoUrl(r.videoUrl) || '' }));
          }
        } catch (e) {
          console.error('Failed to parse cached reels', e);
        }
      }
    }
    return SEED_REELS;
  });

  // 4. Saved posts
  const [savedPostIds, setSavedPostIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_SAVED_POSTS);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse saved posts', e);
        }
      }
    }
    return ['post_001'];
  });

  // 5. Friendships state (Cloud-first + demo user support)
  const [demoRemovedIds, setDemoRemovedIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(LS_REMOVED_DEMO_FRIENDS);
        if (raw) return JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    return [];
  });

  const [friendIds, setFriendIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined' && isPrimaryDemoUser) {
      const saved = localStorage.getItem(LS_FRIENDS);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    return isPrimaryDemoUser ? ['usr_jit_002', 'usr_jit_003'] : [];
  });

  const [pendingIncomingRequestIds, setPendingIncomingRequestIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined' && isPrimaryDemoUser) {
      const saved = localStorage.getItem(LS_PENDING_IN);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    return isPrimaryDemoUser ? ['usr_jit_004'] : [];
  });

  const [pendingOutgoingRequestIds, setPendingOutgoingRequestIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined' && isPrimaryDemoUser) {
      const saved = localStorage.getItem(LS_PENDING_OUT);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    return [];
  });

  // Reset per-user friend lists cleanly when switching accounts
  useEffect(() => {
    if (!currentUser) {
      setFriendIds([]);
      setPendingIncomingRequestIds([]);
      setPendingOutgoingRequestIds([]);
      setCloudNotifications([]);
      setFriendRequests([]);
      return;
    }
    if (currentUser.id === 'usr_jit_primary_001') {
      const blocked = new Set(demoRemovedIds);
      setFriendIds((prev) =>
        Array.from(new Set([...prev, ...['usr_jit_002', 'usr_jit_003'].filter((id) => !blocked.has(id))]))
      );
      setPendingIncomingRequestIds((prev) =>
        Array.from(new Set([...prev, ...['usr_jit_004'].filter((id) => !blocked.has(id))]))
      );
    } else {
      setFriendIds([]);
      setPendingIncomingRequestIds([]);
      setPendingOutgoingRequestIds([]);
    }
  }, [currentUser?.id]);

  // Real-time Firestore Friend Requests & Notifications subscriptions
  useEffect(() => {
    if (!currentUser?.id) return;
    const uid = currentUser.id;
    const isDemo = uid === 'usr_jit_primary_001';
    const blockedDemo = new Set(demoRemovedIds);

    const unsubReqs = subscribeToFirestoreFriendRequests(uid, (state) => {
      setFriendRequests(state.requests);
      if (isDemo) {
        const defaultFriends = ['usr_jit_002', 'usr_jit_003'].filter(
          (id) => !blockedDemo.has(id) && !state.incomingPendingIds.includes(id)
        );
        const defaultIn = ['usr_jit_004'].filter(
          (id) => !blockedDemo.has(id) && !state.acceptedFriendIds.includes(id)
        );
        setFriendIds(Array.from(new Set([...state.acceptedFriendIds, ...defaultFriends])));
        setPendingIncomingRequestIds(Array.from(new Set([...state.incomingPendingIds, ...defaultIn])));
        setPendingOutgoingRequestIds(state.outgoingPendingIds);
      } else {
        setFriendIds(state.acceptedFriendIds);
        setPendingIncomingRequestIds(state.incomingPendingIds);
        setPendingOutgoingRequestIds(state.outgoingPendingIds);
      }
    });

    const unsubNotifs = subscribeToFirestoreNotifications(uid, (items) => {
      setCloudNotifications(items);
    });

    return () => {
      unsubReqs();
      unsubNotifs();
    };
  }, [currentUser?.id, demoRemovedIds]);

  // Real-time Firestore Reels, Posts, and Announcements subscriptions (plus 40-day expiry & delete reconciliation)
  useEffect(() => {
    const unsubReels = subscribeToFirestoreReels((cloudReels) => {
      const nextCloudIds = new Set(cloudReels.map((r) => r.id));
      cloudReelIdsSeenRef.current.forEach((prevId) => {
        if (!nextCloudIds.has(prevId)) {
          deletedReelIdsRef.current.add(prevId);
        }
      });
      cloudReelIdsSeenRef.current = nextCloudIds;

      setReels((prev) => {
        const prevMap = new Map(prev.map((r) => [r.id, r]));
        const byId = new Map<string, Reel>();
        for (const r of cloudReels) {
          const prevMatch = prevMap.get(r.id);
          const resolvedVideoUrl =
            sanitizeVideoUrl(r.videoUrl) ||
            sanitizeVideoUrl(r.mediaUrl) ||
            sanitizeVideoUrl(prevMatch?.videoUrl) ||
            sanitizeVideoUrl(prevMatch?.mediaUrl) ||
            '';
          const candidate: Reel = { ...r, videoUrl: resolvedVideoUrl };
          if (!deletedReelIdsRef.current.has(r.id) && !isVideoContentExpired(candidate)) {
            const isLiked = currentUser?.id ? (r.likedBy || []).includes(currentUser.id) : false;
            byId.set(r.id, { ...candidate, isLiked });
          }
        }
        for (const localR of prev) {
          if (
            !byId.has(localR.id) &&
            !deletedReelIdsRef.current.has(localR.id) &&
            !isVideoContentExpired(localR)
          ) {
            byId.set(localR.id, {
              ...localR,
              videoUrl: sanitizeVideoUrl(localR.videoUrl) || '',
            });
          }
        }
        for (const seedR of SEED_REELS) {
          if (!byId.has(seedR.id) && !deletedReelIdsRef.current.has(seedR.id)) {
            byId.set(seedR.id, seedR);
          }
        }
        return Array.from(byId.values()).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      });
    });

    const unsubPosts = subscribeToFirestorePosts((cloudPosts) => {
      const nextCloudIds = new Set(cloudPosts.map((p) => p.id));
      cloudPostIdsSeenRef.current.forEach((prevId) => {
        if (!nextCloudIds.has(prevId)) {
          deletedPostIdsRef.current.add(prevId);
        }
      });
      cloudPostIdsSeenRef.current = nextCloudIds;

      setPosts((prev) => {
        const prevMap = new Map(prev.map((p) => [p.id, p]));
        const byId = new Map<string, Post>();
        for (const p of cloudPosts) {
          const prevMatch = prevMap.get(p.id);
          const sanitizedCloud = sanitizePostRecordMedia(p);
          const sanitizedPrev = prevMatch ? sanitizePostRecordMedia(prevMatch) : undefined;
          const fallbackUrl =
            sanitizedCloud.videoUrl ||
            sanitizedCloud.mediaUrl ||
            sanitizedPrev?.videoUrl ||
            sanitizedPrev?.mediaUrl;
          const resolvedMediaUrls =
            sanitizedCloud.mediaUrls && sanitizedCloud.mediaUrls.length > 0
              ? sanitizedCloud.mediaUrls
              : sanitizedPrev?.mediaUrls && sanitizedPrev.mediaUrls.length > 0
              ? sanitizedPrev.mediaUrls
              : fallbackUrl
              ? [fallbackUrl]
              : undefined;
          const candidate: Post = sanitizePostRecordMedia({
            ...sanitizedCloud,
            ...(resolvedMediaUrls ? { mediaUrls: resolvedMediaUrls } : {}),
          });
          if (!deletedPostIdsRef.current.has(p.id) && !isVideoContentExpired(candidate)) {
            const isLiked = currentUser?.id ? (p.likedBy || []).includes(currentUser.id) : false;
            const isSaved = savedPostIds.includes(p.id);
            byId.set(p.id, { ...candidate, isLiked, isSaved });
          }
        }
        for (const lp of prev) {
          if (
            !byId.has(lp.id) &&
            !deletedPostIdsRef.current.has(lp.id) &&
            !isVideoContentExpired(lp)
          ) {
            byId.set(lp.id, sanitizePostRecordMedia(lp));
          }
        }
        return Array.from(byId.values()).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      });
    });

    const unsubAnnouncements = subscribeToFirestoreAnnouncements((items) => {
      setCloudAnnouncements(items.filter((a) => !isVideoContentExpired(a)));
    });

    return () => {
      unsubReels();
      unsubPosts();
      unsubAnnouncements();
    };
  }, [currentUser?.id]);

  // Background 40-day video auto-expiry cleanup (Firestore + IndexedDB + in-memory UI state)
  useEffect(() => {
    const runExpirySweep = () => {
      setReels((prev) => prev.filter((r) => !isVideoContentExpired(r)));
      setPosts((prev) => prev.filter((p) => !isVideoContentExpired(p)));
      setCloudAnnouncements((prev) => prev.filter((a) => !isVideoContentExpired(a)));
      setServerAnnouncements((prev) => prev.filter((a) => !isVideoContentExpired(a)));
      purgeExpiredLocalMedia().catch(() => {});
      purgeExpiredCloudVideos().catch(() => {});
    };

    runExpirySweep();
    const timer = window.setInterval(runExpirySweep, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Safe LocalStorage caching (never crashes on large videos)
  useEffect(() => {
    safeSetLocalStorage(LS_POSTS, sanitizePostsForCache(posts));
    safeSetLocalStorage(LS_STORIES, stories.slice(0, 30));
    safeSetLocalStorage(LS_REELS, sanitizeReelsForCache(reels));
    safeSetLocalStorage(LS_SAVED_POSTS, savedPostIds);
    safeSetLocalStorage(LS_REMOVED_DEMO_FRIENDS, demoRemovedIds);
    if (isPrimaryDemoUser) {
      safeSetLocalStorage(LS_FRIENDS, friendIds);
      safeSetLocalStorage(LS_PENDING_IN, pendingIncomingRequestIds);
      safeSetLocalStorage(LS_PENDING_OUT, pendingOutgoingRequestIds);
    }
  }, [
    posts,
    stories,
    reels,
    savedPostIds,
    friendIds,
    pendingIncomingRequestIds,
    pendingOutgoingRequestIds,
    demoRemovedIds,
    isPrimaryDemoUser,
  ]);

  useEffect(() => {
    const byId = new Map<string, GlobalAnnouncement>();
    for (const a of [...cloudAnnouncements, ...serverAnnouncements]) {
      if (!isVideoContentExpired(a) && !byId.has(a.id)) {
        byId.set(a.id, a);
      }
    }
    const merged = Array.from(byId.values()).sort(
      (a, b) => (b.createdAtMs || Date.parse(b.createdAt) || 0) - (a.createdAtMs || Date.parse(a.createdAt) || 0)
    );
    setAnnouncements(merged);
  }, [cloudAnnouncements, serverAnnouncements]);

  const refreshAnnouncements = useCallback(async () => {
    try {
      const hasBackend = await detectExpressBackendAvailable();
      if (!hasBackend) {
        return;
      }
      const [annRes, postsRes] = await Promise.all([
        safeFetchJson<{ announcements?: GlobalAnnouncement[] }>('/api/announcements'),
        safeFetchJson<{ posts?: Post[] }>('/api/posts'),
      ]);
      if (annRes.ok && annRes.data && Array.isArray(annRes.data.announcements)) {
        setServerAnnouncements(
          annRes.data.announcements.filter((a: GlobalAnnouncement) => !isVideoContentExpired(a))
        );
      }
      if (postsRes.ok && postsRes.data && Array.isArray(postsRes.data.posts) && postsRes.data.posts.length > 0) {
        const incomingPosts = postsRes.data.posts;
        setPosts((prev) => {
          const existingMap = new Map(prev.map((p) => [p.id, p]));
          const merged: Post[] = [];
          const seen = new Set<string>();
          for (const sp of incomingPosts) {
            if (!seen.has(sp.id) && !deletedPostIdsRef.current.has(sp.id) && !isVideoContentExpired(sp)) {
              seen.add(sp.id);
              const localMatch = existingMap.get(sp.id);
              merged.push(
                localMatch && sp.authorId !== 'usr_jit_admin_system'
                  ? localMatch
                  : sp
              );
            }
          }
          for (const lp of prev) {
            if (
              !seen.has(lp.id) &&
              !lp.id.startsWith('post_ann_') &&
              !deletedPostIdsRef.current.has(lp.id) &&
              !isVideoContentExpired(lp)
            ) {
              seen.add(lp.id);
              merged.push(lp);
            }
          }
          return merged;
        });
      }
    } catch {
      // Non-fatal offline / serverless fallback
    } finally {
      postsHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    refreshAnnouncements();
  }, [refreshAnnouncements]);

  // Persist user post updates (new posts, edits, comments, likes) when backend server is active
  useEffect(() => {
    if (!postsHydratedRef.current) return;
    const timeout = setTimeout(async () => {
      if (!(await detectExpressBackendAvailable())) return;
      fetch('/api/posts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts: sanitizePostsForCache(posts) }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timeout);
  }, [posts]);

  // Keep posts, comments, stories, and reels author info in sync if currentUser updates profile
  useEffect(() => {
    if (currentUser) {
      setPosts((prev) =>
        prev.map((p) => {
          const updatedComments = (p.comments || []).map((c) => ({
            ...c,
            ...(c.authorId === currentUser.id
              ? { authorName: currentUser.fullName, authorAvatar: currentUser.avatarUrl }
              : {}),
            replies: (c.replies || []).map((r) =>
              r.authorId === currentUser.id
                ? { ...r, authorName: currentUser.fullName, authorAvatar: currentUser.avatarUrl }
                : r
            ),
          }));

          return {
            ...p,
            ...(p.authorId === currentUser.id
              ? {
                  authorName: currentUser.fullName,
                  authorAvatar: currentUser.avatarUrl,
                }
              : {}),
            comments: updatedComments,
          };
        })
      );
      setStories((prev) =>
        prev.map((s) =>
          s.authorId === currentUser.id
            ? {
                ...s,
                authorName: currentUser.fullName,
                authorAvatar: currentUser.avatarUrl,
              }
            : s
        )
      );
      setReels((prev) =>
        prev.map((r) =>
          r.creatorId === currentUser.id
            ? {
                ...r,
                creatorName: currentUser.fullName,
                creatorAvatar: currentUser.avatarUrl,
              }
            : r
        )
      );
    }
  }, [currentUser?.id, currentUser?.avatarUrl, currentUser?.fullName]);

  // Synthesize peer UserProfile entries from Firestore FriendRequest documents
  // so brand-new senders are always visible in FriendsView even before directory refresh
  const friendRequestPeers: UserProfile[] = React.useMemo(() => {
    if (!currentUser?.id) return [];
    const map = new Map<string, UserProfile>();
    for (const req of friendRequests) {
      const isIncoming = req.toUserId === currentUser.id;
      const peerId = isIncoming ? req.fromUserId : req.toUserId;
      const peerName = isIncoming ? req.fromUserName : req.toUserName;
      const peerAvatar = isIncoming ? req.fromUserAvatar : req.toUserAvatar;
      if (!peerId || peerId === currentUser.id || map.has(peerId)) continue;
      map.set(peerId, {
        id: peerId,
        contactNumber: 'Private',
        fullName: peerName || 'JIT Member',
        username: deriveUsername(peerName || 'JIT Member'),
        address: 'JIT Campus',
        bio: 'JIT Campus Member',
        avatarUrl: peerAvatar || APP_CONFIG.logoUrl,
        joinedAt: req.createdAtIso || new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        stats: {
          friendsCount: 1,
          followersCount: 1,
          followingCount: 1,
          postsCount: 0,
          reelsCount: 0,
          gamesPlayed: 0,
          gamesWon: 0,
          rewardPoints: 100,
          streakDays: 1,
        },
      });
    }
    return Array.from(map.values());
  }, [friendRequests, currentUser?.id]);

  // Combine cloud notifications with initial demo notifications for the demo user
  const notifications: InAppNotification[] = React.useMemo(() => {
    if (!currentUser?.id) return [];
    const seen = new Set<string>();
    const combined: InAppNotification[] = [];
    for (const n of cloudNotifications) {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        combined.push(n);
      }
    }
    if (isPrimaryDemoUser) {
      for (const n of INITIAL_NOTIFICATIONS) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          combined.push(n);
        }
      }
    }
    return combined;
  }, [cloudNotifications, currentUser?.id, isPrimaryDemoUser]);

  const unreadNotificationCount =
    notifications.filter((n) => !n.isRead).length + pendingIncomingRequestIds.length;

  const markNotificationRead = useCallback((notificationId: string) => {
    setCloudNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
    );
    markFirestoreNotificationRead(notificationId).catch(() => {});
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    const unreadIds = cloudNotifications.filter((n) => !n.isRead).map((n) => n.id);
    setCloudNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    if (unreadIds.length > 0) {
      markAllFirestoreNotificationsRead(unreadIds).catch(() => {});
    }
  }, [cloudNotifications]);

  const openDirectChat = useCallback((partner: ActiveChatPartner) => {
    setActiveChatPartner(partner);
  }, []);

  const clearActiveChatPartner = useCallback(() => {
    setActiveChatPartner(null);
  }, []);

  // Helpers
  const createPost = ({
    content,
    mediaUrls = [],
    mediaType = 'none',
    thumbnailUrl,
    createdAtMs,
    expiresAt,
    category = 'all',
  }: {
    content: string;
    mediaUrls?: string[];
    mediaType?: 'image' | 'video' | 'none';
    thumbnailUrl?: string;
    createdAtMs?: number;
    expiresAt?: number;
    category?: 'all' | 'friends' | 'following' | 'popular';
  }) => {
    if (!currentUser) return;
    const nowMs = createdAtMs || Date.now();
    const resolvedExpiresAt =
      mediaType === 'video' ? expiresAt || nowMs + VIDEO_EXPIRY_MS : expiresAt;
    const newPost: Post = {
      id: `post_${nowMs}_${Math.random().toString(36).substring(2, 6)}`,
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      authorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      authorHandle: `@${currentUser.username || deriveUsername(currentUser.fullName)}`,
      content: content.trim(),
      mediaUrls,
      mediaType,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      createdAt: 'Just now',
      createdAtMs: nowMs,
      ...(typeof resolvedExpiresAt === 'number' ? { expiresAt: resolvedExpiresAt } : {}),
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      isLiked: false,
      isSaved: false,
      likedBy: [],
      comments: [],
      category,
    };

    setPosts((prev) => [newPost, ...prev]);
    publishFirestorePost(newPost).catch(() => {});
  };

  const editPost = (
    postId: string,
    content: string,
    mediaUrls?: string[],
    mediaType?: 'image' | 'video' | 'none'
  ) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          return {
            ...p,
            content,
            ...(mediaUrls !== undefined ? { mediaUrls } : {}),
            ...(mediaType !== undefined ? { mediaType } : {}),
          };
        }
        return p;
      })
    );
    updateFirestorePostInteraction(postId, {
      content,
      ...(mediaUrls !== undefined ? { mediaUrls } : {}),
      ...(mediaType !== undefined ? { mediaType } : {}),
    }).catch(() => {});
  };

  const deletePost = (postId: string) => {
    deletedPostIdsRef.current.add(postId);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    deleteFirestorePost(postId).catch(() => {});
  };

  const toggleLikePost = (postId: string) => {
    if (!currentUser) return;
    const uid = currentUser.id;

    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const currentLikedBy = p.likedBy || [];
          const alreadyLiked = currentLikedBy.includes(uid) || !!p.isLiked;
          const newLikedBy = alreadyLiked
            ? currentLikedBy.filter((id) => id !== uid)
            : [...currentLikedBy, uid];
          const nextCount = Math.max(0, alreadyLiked ? p.likesCount - 1 : p.likesCount + 1);

          updateFirestorePostInteraction(postId, {
            likedBy: newLikedBy,
            likesCount: nextCount,
          }).catch(() => {});

          return {
            ...p,
            isLiked: !alreadyLiked,
            likedBy: newLikedBy,
            likesCount: nextCount,
          };
        }
        return p;
      })
    );
  };

  const getPostLikers = (postId: string): UserProfile[] => {
    const post = posts.find((p) => p.id === postId);
    if (!post) return [];
    const likerIds = post.likedBy || [];
    const allKnown = [INITIAL_USER, ...INITIAL_FRIENDS, ...(registeredProfiles || []), ...friendRequestPeers];

    const matched: UserProfile[] = [];
    const seen = new Set<string>();

    likerIds.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const user = allKnown.find((u) => u.id === id);
      if (user) {
        matched.push(user);
      } else {
        matched.push({
          id,
          fullName: 'Campus Member',
          contactNumber: 'Private',
          address: 'JIT Campus',
          avatarUrl: APP_CONFIG.logoUrl,
          joinedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
          stats: {
            friendsCount: 1,
            followersCount: 1,
            followingCount: 1,
            postsCount: 1,
            reelsCount: 0,
            gamesPlayed: 5,
            gamesWon: 2,
            rewardPoints: 100,
            streakDays: 1,
          },
        });
      }
    });

    return matched;
  };

  const addComment = (postId: string, content: string, parentCommentId?: string) => {
    if (!currentUser || !content.trim()) return;

    const newComment: Comment = {
      id: `comm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      postId,
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      authorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      content: content.trim(),
      createdAt: 'Just now',
      likesCount: 0,
      parentId: parentCommentId,
      replies: [],
    };

    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const existingComments = p.comments || [];
          let updatedComments: Comment[];

          if (parentCommentId) {
            updatedComments = existingComments.map((c) => {
              if (c.id === parentCommentId) {
                return {
                  ...c,
                  replies: [...(c.replies || []), newComment],
                };
              }
              return c;
            });
          } else {
            updatedComments = [...existingComments, newComment];
          }

          const nextCount = p.commentsCount + 1;
          updateFirestorePostInteraction(postId, {
            commentsJson: JSON.stringify(updatedComments).slice(0, 95000),
            commentsCount: nextCount,
          }).catch(() => {});

          return {
            ...p,
            comments: updatedComments,
            commentsCount: nextCount,
          };
        }
        return p;
      })
    );
  };

  const toggleSavePost = (postId: string) => {
    setSavedPostIds((prev) => {
      const exists = prev.includes(postId);
      const next = exists ? prev.filter((id) => id !== postId) : [...prev, postId];
      setPosts((pList) =>
        pList.map((p) => (p.id === postId ? { ...p, isSaved: !exists } : p))
      );
      return next;
    });
  };

  const addStory = ({
    mediaUrl,
    mediaType,
    caption,
  }: {
    mediaUrl: string;
    mediaType: 'image' | 'video';
    caption?: string;
  }) => {
    if (!currentUser) return;
    const newStory: Story = {
      id: `story_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      authorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      mediaUrl,
      mediaType,
      caption: caption?.trim(),
      createdAt: 'Just now',
      expiresAt: '24h left',
      viewCount: 1,
      isViewed: false,
    };

    setStories((prev) => [newStory, ...prev]);
  };

  const deleteStory = (storyId: string) => {
    setStories((prev) => prev.filter((s) => s.id !== storyId));
  };

  const addReel = ({
    videoUrl,
    thumbnailUrl,
    caption,
    musicTitle,
    createdAtMs,
    expiresAt,
  }: {
    videoUrl: string;
    thumbnailUrl?: string;
    caption: string;
    musicTitle?: string;
    createdAtMs?: number;
    expiresAt?: number;
  }) => {
    if (!currentUser) return;
    const nowMs = createdAtMs || Date.now();
    const resolvedExpiresAt = expiresAt || nowMs + VIDEO_EXPIRY_MS;
    const newReel: Reel = {
      id: `reel_${nowMs}_${Math.random().toString(36).substring(2, 6)}`,
      creatorId: currentUser.id,
      creatorName: currentUser.fullName,
      creatorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      videoUrl,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      caption: caption.trim(),
      musicTitle: musicTitle || 'JIT Campus Vibes',
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 1,
      isLiked: false,
      likedBy: [],
      comments: [],
      createdAt: 'Just now',
      createdAtMs: nowMs,
      expiresAt: resolvedExpiresAt,
    };

    setReels((prev) => [newReel, ...prev]);
    publishFirestoreReel(newReel).catch(() => {});
  };

  const deleteReel = (reelId: string) => {
    deletedReelIdsRef.current.add(reelId);
    setReels((prev) => prev.filter((r) => r.id !== reelId));
    deleteFirestoreReel(reelId).catch(() => {});
  };

  const toggleLikeReel = (reelId: string) => {
    if (!currentUser) return;
    const uid = currentUser.id;

    setReels((prev) =>
      prev.map((r) => {
        if (r.id === reelId) {
          const currentLikedBy = r.likedBy || [];
          const alreadyLiked = currentLikedBy.includes(uid) || !!r.isLiked;
          const newLikedBy = alreadyLiked
            ? currentLikedBy.filter((id) => id !== uid)
            : [...currentLikedBy, uid];
          const nextCount = Math.max(0, alreadyLiked ? r.likesCount - 1 : r.likesCount + 1);

          updateFirestoreReelInteraction(reelId, {
            likedBy: newLikedBy,
            likesCount: nextCount,
          }).catch(() => {});

          return {
            ...r,
            isLiked: !alreadyLiked,
            likedBy: newLikedBy,
            likesCount: nextCount,
          };
        }
        return r;
      })
    );
  };

  const addReelComment = (reelId: string, content: string) => {
    if (!currentUser || !content.trim()) return;

    const newComment: Comment = {
      id: `rcomm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      postId: reelId,
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      authorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      content: content.trim(),
      createdAt: 'Just now',
      likesCount: 0,
    };

    setReels((prev) =>
      prev.map((r) => {
        if (r.id === reelId) {
          const updatedComments = [...(r.comments || []), newComment];
          const nextCount = r.commentsCount + 1;
          updateFirestoreReelInteraction(reelId, {
            commentsJson: JSON.stringify(updatedComments).slice(0, 95000),
            commentsCount: nextCount,
          }).catch(() => {});
          return {
            ...r,
            comments: updatedComments,
            commentsCount: nextCount,
          };
        }
        return r;
      })
    );
  };

  // Friendship management (real-time Firestore + optimistic local UI)
  const sendFriendRequest = (userId: string, targetProfile?: Partial<UserProfile>) => {
    if (!currentUser || !userId || userId === currentUser.id) return;
    if (friendIds.includes(userId) || pendingOutgoingRequestIds.includes(userId)) return;
    setPendingOutgoingRequestIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));

    const knownPeer =
      targetProfile ||
      [...registeredProfiles, INITIAL_USER, ...INITIAL_FRIENDS, ...friendRequestPeers].find(
        (u) => u.id === userId
      );

    sendFirestoreFriendRequest(currentUser, {
      id: userId,
      fullName: knownPeer?.fullName,
      avatarUrl: knownPeer?.avatarUrl,
    }).catch((err) => {
      console.warn('Friend request cloud sync notice:', err);
    });
  };

  const acceptFriendRequest = (userId: string) => {
    if (!currentUser) return;
    setPendingIncomingRequestIds((prev) => prev.filter((id) => id !== userId));
    setFriendIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    setDemoRemovedIds((prev) => prev.filter((id) => id !== userId));
    respondToFirestoreFriendRequest(userId, currentUser, 'accepted').catch(() => {});
  };

  const rejectFriendRequest = (userId: string) => {
    if (!currentUser) return;
    setPendingIncomingRequestIds((prev) => prev.filter((id) => id !== userId));
    if (isPrimaryDemoUser) {
      setDemoRemovedIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    }
    respondToFirestoreFriendRequest(userId, currentUser, 'declined').catch(() => {});
  };

  const removeFriend = (userId: string) => {
    if (!currentUser) return;
    setFriendIds((prev) => prev.filter((id) => id !== userId));
    if (isPrimaryDemoUser) {
      setDemoRemovedIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    }
    removeFirestoreFriendship(currentUser.id, userId).catch(() => {});
  };

  const isFriend = (userId: string) => friendIds.includes(userId);
  const hasPendingOutgoing = (userId: string) => pendingOutgoingRequestIds.includes(userId);
  const hasPendingIncoming = (userId: string) => pendingIncomingRequestIds.includes(userId);

  return (
    <SocialContext.Provider
      value={{
        posts,
        stories,
        reels,
        announcements,
        notifications,
        unreadNotificationCount,
        friendRequestPeers,
        activeChatPartner,
        openDirectChat,
        clearActiveChatPartner,
        pendingGameInvite,
        joinInvitedGameRoom: (roomId: string, gameId?: string) => {
          const clean = roomId.trim().replace(/^#/, '');
          if (!clean) return;
          setPendingGameInvite({ roomId: clean, gameId, requestedAt: Date.now() });
        },
        clearPendingGameInvite: () => setPendingGameInvite(null),
        markNotificationRead,
        markAllNotificationsRead,
        refreshAnnouncements,
        savedPostIds,
        friendIds,
        pendingIncomingRequestIds,
        pendingOutgoingRequestIds,
        viewingUserId,
        setViewingUserId,
        createPost,
        editPost,
        deletePost,
        toggleLikePost,
        getPostLikers,
        addComment,
        toggleSavePost,
        addStory,
        deleteStory,
        addReel,
        deleteReel,
        toggleLikeReel,
        addReelComment,
        sendFriendRequest,
        acceptFriendRequest,
        rejectFriendRequest,
        removeFriend,
        isFriend,
        hasPendingOutgoing,
        hasPendingIncoming,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
};

export function useSocial(): SocialContextType {
  const context = useContext(SocialContext);
  if (!context) {
    throw new Error('useSocial must be used within a SocialProvider');
  }
  return context;
}
