/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export type NavTab =
  | 'home'
  | 'friends'
  | 'reels'
  | 'games'
  | 'messages'
  | 'groups'
  | 'tournaments'
  | 'wallet'
  | 'profile'
  | 'settings'
  | 'login'
  | 'register'
  | 'admin';

export interface UserProfile {
  id: string; // Permanent UUID
  contactNumber: string; // Private by default
  fullName: string;
  address: string; // Private by default
  bio?: string;
  avatarUrl?: string;
  coverUrl?: string;
  joinedAt: string;
  lastLoginAt: string; // Used for 180-day inactivity check
  lastLogin?: string; // Standard timestamp alias for account retention tracking
  isContactNumberPublic?: boolean;
  isAddressPublic?: boolean;
  stats: {
    friendsCount: number;
    followersCount: number;
    followingCount: number;
    postsCount: number;
    reelsCount: number;
    gamesPlayed: number;
    gamesWon: number;
    rewardPoints: number;
    streakDays: number;
  };
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  authorHandle?: string;
  content: string;
  mediaUrls?: string[];
  mediaType?: 'image' | 'video' | 'none';
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  isLiked?: boolean;
  isSaved?: boolean;
  likedBy?: string[];
  comments?: Comment[];
  category: 'all' | 'friends' | 'following' | 'popular';
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  createdAt: string;
  likesCount: number;
  parentId?: string;
  replies?: Comment[];
}

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
  createdAt: string;
  expiresAt: string; // 24 hours
  viewCount: number;
  isViewed?: boolean;
}

export interface Reel {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string;
  videoUrl: string;
  caption: string;
  musicTitle?: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  isLiked?: boolean;
  isFollowing?: boolean;
  likedBy?: string[];
  comments?: Comment[];
  createdAt: string;
}

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  avatarUrl?: string;
  participantIds: string[];
  lastMessage?: {
    text: string;
    senderId: string;
    createdAt: string;
    isRead: boolean;
  };
  unreadCount: number;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'file';
  createdAt: string;
  status: 'sent' | 'delivered' | 'read';
}

export type CallType = 'voice' | 'video';
export type CallStatus = 'idle' | 'calling' | 'incoming' | 'connected' | 'ended' | 'rejected';

export interface CallSession {
  id: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  receiverId: string;
  receiverName: string;
  receiverAvatar?: string;
  type: CallType;
  status: CallStatus;
  startedAt?: string;
  durationSeconds?: number;
}

export type GameId = 'ludo' | 'tictactoe' | 'quiz' | 'chess' | 'snake_ladder' | 'carrom' | 'spin_wheel';

export interface GameMetadata {
  id: GameId;
  name: string;
  players: string;
  category: string;
  description: string;
  instructions: string[];
  rulesSummary: string;
}

export interface LeaderboardEntry {
  profileId: string;
  fullName: string;
  avatarUrl?: string;
  rewardPoints: number;
  gamesPlayed: number;
  gamesWon: number;
  streakDays: number;
  lastGameId?: string;
  updatedAt?: string;
}

export interface MatchHistoryRecord {
  id: string;
  profileId: string;
  playerName: string;
  gameId: GameId;
  gameName: string;
  mode: 'ai' | 'friend' | 'random' | 'solo';
  outcome: 'win' | 'loss' | 'draw' | 'spin';
  pointsEarned: number;
  scoreSummary: string;
  createdAt: string;
}

export interface GameRoom {
  roomCode: string;
  gameId: GameId;
  hostId: string;
  status: 'waiting' | 'in_progress' | 'completed';
  maxPlayers: number;
  players: {
    id: string;
    name: string;
    avatar?: string;
    isReady: boolean;
    score: number;
  }[];
  createdAt: string;
}

export interface Tournament {
  id: string;
  gameId: GameId;
  title: string;
  entryFeePoints: number;
  prizePoolPoints: number;
  totalSlots: number;
  registeredCount: number;
  status: 'upcoming' | 'live' | 'completed';
  startDate: string;
  winner?: {
    id: string;
    name: string;
  };
}

export interface WalletTransaction {
  id: string;
  userId: string;
  amount: number; // positive for earn, negative for spend
  type: 'daily_reward' | 'game_reward' | 'quiz_reward' | 'achievement' | 'tournament_entry' | 'tournament_prize';
  description: string;
  createdAt: string;
}

export interface Achievement {
  id: string;
  code: string;
  title: string;
  description: string;
  iconName: string;
  rewardPoints: number;
  unlockedAt?: string;
  isUnlocked: boolean;
}

export interface InAppNotification {
  id: string;
  userId: string;
  type:
    | 'friend_request'
    | 'friend_accept'
    | 'like'
    | 'comment'
    | 'message'
    | 'call'
    | 'game_invite'
    | 'tournament'
    | 'reward'
    | 'achievement';
  title: string;
  message: string;
  createdAt: string;
  isRead: boolean;
  actionUrl?: string;
}
