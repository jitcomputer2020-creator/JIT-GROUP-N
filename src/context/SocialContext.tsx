/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Centralized Social Context
 * Coordinates posts, stories, reels, comments, likes, friendships, and user profile viewing
 * with full local persistence across page refreshes.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Post, Story, Reel, Comment, UserProfile } from '../types';
import { INITIAL_POSTS, INITIAL_STORIES, INITIAL_REELS, INITIAL_FRIENDS, INITIAL_USER } from '../services/mockData';
import { useAuth } from './AuthContext';
import { APP_CONFIG } from '../constants/branding';

interface SocialContextType {
  posts: Post[];
  stories: Story[];
  reels: Reel[];
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
  addReel: (params: { videoUrl: string; caption: string; musicTitle?: string }) => void;
  toggleLikeReel: (reelId: string) => void;
  addReelComment: (reelId: string, content: string) => void;
  sendFriendRequest: (userId: string) => void;
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

export const SocialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, registeredProfiles } = useAuth();
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);

  // 1. Posts state
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_POSTS);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse cached posts', e);
        }
      }
    }
    // Enrich INITIAL_POSTS with default likedBy and comments
    return INITIAL_POSTS.map((p) => ({
      ...p,
      likedBy: p.isLiked ? ['usr_jit_primary_001', 'usr_jit_002', 'usr_jit_003'] : ['usr_jit_002', 'usr_jit_004'],
      comments: SEED_COMMENTS[p.id] || [],
    }));
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

  // 3. Reels state
  const [reels, setReels] = useState<Reel[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_REELS);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse cached reels', e);
        }
      }
    }
    return INITIAL_REELS.map((r) => ({
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

  // 5. Friendships state
  const [friendIds, setFriendIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_FRIENDS);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse friends', e);
        }
      }
    }
    return ['usr_jit_002', 'usr_jit_003'];
  });

  const [pendingIncomingRequestIds, setPendingIncomingRequestIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_PENDING_IN);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse pending incoming', e);
        }
      }
    }
    return ['usr_jit_004'];
  });

  const [pendingOutgoingRequestIds, setPendingOutgoingRequestIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LS_PENDING_OUT);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse pending outgoing', e);
        }
      }
    }
    return [];
  });

  // Sync to local storage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_POSTS, JSON.stringify(posts));
      localStorage.setItem(LS_STORIES, JSON.stringify(stories));
      localStorage.setItem(LS_REELS, JSON.stringify(reels));
      localStorage.setItem(LS_SAVED_POSTS, JSON.stringify(savedPostIds));
      localStorage.setItem(LS_FRIENDS, JSON.stringify(friendIds));
      localStorage.setItem(LS_PENDING_IN, JSON.stringify(pendingIncomingRequestIds));
      localStorage.setItem(LS_PENDING_OUT, JSON.stringify(pendingOutgoingRequestIds));
    }
  }, [posts, stories, reels, savedPostIds, friendIds, pendingIncomingRequestIds, pendingOutgoingRequestIds]);

  // Keep posts author info in sync if currentUser updates profile
  useEffect(() => {
    if (currentUser) {
      setPosts((prev) =>
        prev.map((p) =>
          p.authorId === currentUser.id
            ? {
                ...p,
                authorName: currentUser.fullName,
                authorAvatar: currentUser.avatarUrl,
              }
            : p
        )
      );
      setStories((prev) =>
        prev.map((s) =>
          s.authorId === currentUser.id
            ? {
                ...s,
                authorAvatar: currentUser.avatarUrl,
              }
            : s
        )
      );
    }
  }, [currentUser?.avatarUrl, currentUser?.fullName]);

  // Helpers
  const createPost = ({
    content,
    mediaUrls = [],
    mediaType = 'none',
    category = 'all',
  }: {
    content: string;
    mediaUrls?: string[];
    mediaType?: 'image' | 'video' | 'none';
    category?: 'all' | 'friends' | 'following' | 'popular';
  }) => {
    if (!currentUser) return;
    const newPost: Post = {
      id: `post_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      authorId: currentUser.id,
      authorName: currentUser.fullName,
      authorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      authorHandle: `@${currentUser.fullName.toLowerCase().replace(/\s+/g, '_')}`,
      content: content.trim(),
      mediaUrls,
      mediaType,
      createdAt: 'Just now',
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
  };

  const deletePost = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
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

          return {
            ...p,
            isLiked: !alreadyLiked,
            likedBy: newLikedBy,
            likesCount: Math.max(0, alreadyLiked ? p.likesCount - 1 : p.likesCount + 1),
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
    const allKnown = [INITIAL_USER, ...INITIAL_FRIENDS, ...(registeredProfiles || [])];

    // Deduplicate by id
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
            // Append as nested reply
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
            // Append as top-level comment
            updatedComments = [...existingComments, newComment];
          }

          return {
            ...p,
            comments: updatedComments,
            commentsCount: p.commentsCount + 1,
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
    caption,
    musicTitle,
  }: {
    videoUrl: string;
    caption: string;
    musicTitle?: string;
  }) => {
    if (!currentUser) return;
    const newReel: Reel = {
      id: `reel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      creatorId: currentUser.id,
      creatorName: currentUser.fullName,
      creatorAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      videoUrl,
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
    };

    setReels((prev) => [newReel, ...prev]);
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

          return {
            ...r,
            isLiked: !alreadyLiked,
            likedBy: newLikedBy,
            likesCount: Math.max(0, alreadyLiked ? r.likesCount - 1 : r.likesCount + 1),
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
          return {
            ...r,
            comments: [...(r.comments || []), newComment],
            commentsCount: r.commentsCount + 1,
          };
        }
        return r;
      })
    );
  };

  // Friendship management
  const sendFriendRequest = (userId: string) => {
    if (friendIds.includes(userId) || pendingOutgoingRequestIds.includes(userId)) return;
    setPendingOutgoingRequestIds((prev) => [...prev, userId]);
  };

  const acceptFriendRequest = (userId: string) => {
    setPendingIncomingRequestIds((prev) => prev.filter((id) => id !== userId));
    setFriendIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
  };

  const rejectFriendRequest = (userId: string) => {
    setPendingIncomingRequestIds((prev) => prev.filter((id) => id !== userId));
  };

  const removeFriend = (userId: string) => {
    setFriendIds((prev) => prev.filter((id) => id !== userId));
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
