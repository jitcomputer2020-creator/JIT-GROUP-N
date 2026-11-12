/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { NavTab, UserProfile } from '../types';
import { INITIAL_ACHIEVEMENTS } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import { saveMediaFile, validateMediaFile } from '../services/mediaStorage';
import {
  Edit3,
  Calendar,
  MapPin,
  Smartphone,
  Trophy,
  Award,
  Video,
  FileText,
  Check,
  X,
  Camera,
  Copy,
  LogOut,
  UserPlus,
  LogIn,
  ArrowLeft,
  MessageSquare,
  UserCheck,
  Loader2,
  Trash2,
} from 'lucide-react';

import { PhotoUploadModal } from '../components/modals/PhotoUploadModal';

interface ProfileViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onNavigate }) => {
  const { currentUser, registeredProfiles, updateProfile, logout } = useAuth();
  const {
    posts,
    reels,
    viewingUserId,
    setViewingUserId,
    isFriend,
    hasPendingOutgoing,
    sendFriendRequest,
    removeFriend,
  } = useSocial();

  const [activeTab, setActiveTab] = useState<'posts' | 'reels' | 'achievements'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [photoModalState, setPhotoModalState] = useState<{
    isOpen: boolean;
    mode: 'avatar' | 'cover';
  }>({
    isOpen: false,
    mode: 'avatar',
  });

  // Edit form state
  const [editName, setEditName] = useState(currentUser?.fullName || '');
  const [editBio, setEditBio] = useState(currentUser?.bio || '');
  const [editAddress, setEditAddress] = useState(currentUser?.address || '');
  const [isContactPublic, setIsContactPublic] = useState(currentUser?.isContactNumberPublic || false);
  const [isAddressPublicState, setIsAddressPublicState] = useState(currentUser?.isAddressPublic || false);

  // Determine if viewing own profile or someone else's
  const isViewingOther = !!viewingUserId && viewingUserId !== currentUser?.id;
  const targetUser: UserProfile | null = isViewingOther
    ? registeredProfiles.find((u) => u.id === viewingUserId) || null
    : currentUser;

  // Filter posts and reels belonging to this profile
  const profileUserId = targetUser?.id || '';
  const userPosts = posts.filter((p) => p.authorId === profileUserId);
  const userReels = reels.filter((r) => r.creatorId === profileUserId);

  const handleOpenPhotoModal = (mode: 'avatar' | 'cover') => {
    setPhotoModalState({ isOpen: true, mode });
  };

  const handleSavePhotoModal = async (photoDataUrl: string) => {
    if (photoModalState.mode === 'avatar') {
      await updateProfile({ avatarUrl: photoDataUrl });
    } else {
      await updateProfile({ coverUrl: photoDataUrl });
    }
  };

  const handleRemovePhotoModal = async () => {
    if (photoModalState.mode === 'avatar') {
      await updateProfile({ avatarUrl: APP_CONFIG.logoUrl });
    } else {
      await updateProfile({ coverUrl: '' });
    }
  };

  const handleOpenEdit = () => {
    if (!currentUser) return;
    setEditName(currentUser.fullName);
    setEditBio(currentUser.bio || '');
    setEditAddress(currentUser.address || '');
    setIsContactPublic(currentUser.isContactNumberPublic || false);
    setIsAddressPublicState(currentUser.isAddressPublic || false);
    setShowEditModal(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({
      fullName: editName,
      bio: editBio,
      address: editAddress,
      isContactNumberPublic: isContactPublic,
      isAddressPublic: isAddressPublicState,
    });
    setShowEditModal(false);
  };

  const handleCopyId = () => {
    if (!targetUser) return;
    navigator.clipboard.writeText(targetUser.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  if (!currentUser && !targetUser) {
    return (
      <div className="max-w-md mx-auto py-12 px-6 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <img
          src={APP_CONFIG.logoUrl}
          alt={APP_CONFIG.name}
          className="w-16 h-16 rounded-2xl bg-white p-1 mx-auto shadow-md border border-slate-100"
        />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          No Profile Signed In
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
          Please sign in with your registered contact number to view your profile, posts, and achievements.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5 pt-2 justify-center">
          <button
            onClick={() => onNavigate('login')}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
          <button
            onClick={() => onNavigate('register')}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Register Profile</span>
          </button>
        </div>
      </div>
    );
  }

  const user = targetUser || currentUser!;

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* Back button when viewing other user */}
      {isViewingOther && (
        <button
          onClick={() => setViewingUserId(null)}
          className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to My Profile</span>
        </button>
      )}

      {/* 1. Profile Header with Cover & Avatar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        {/* Cover Photo */}
        <div className="relative h-36 sm:h-64 bg-gradient-to-r from-blue-700 via-indigo-700 to-emerald-600">
          {user.coverUrl && (
            <img
              src={user.coverUrl}
              alt="Profile Cover"
              className="w-full h-full object-cover"
            />
          )}

          {/* Cover photo update button (Only on own profile) */}
          {!isViewingOther && (
            <button
              onClick={() => handleOpenPhotoModal('cover')}
              className="absolute bottom-3 right-3 px-3.5 py-1.5 bg-black/60 hover:bg-black/80 active:scale-95 backdrop-blur-md text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-md"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Update Cover</span>
            </button>
          )}
        </div>

        {/* Profile Info Bar */}
        <div className="p-4 sm:p-6 relative">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 sm:-mt-20 mb-4">
            <div className="relative">
              <img
                src={user.avatarUrl || APP_CONFIG.logoUrl}
                alt={user.fullName}
                className="w-20 h-20 sm:w-28 sm:h-28 rounded-3xl object-cover ring-4 ring-white dark:ring-slate-900 shadow-xl bg-white p-0.5"
              />

              {/* Avatar update button (Only on own profile) */}
              {!isViewingOther && (
                <button
                  onClick={() => handleOpenPhotoModal('avatar')}
                  className="absolute bottom-1 right-1 p-2 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
                  title="Change Profile Photo"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Actions: Edit Profile (Own) OR Friend / Message (Other) */}
            <div className="flex items-center gap-2">
              {!isViewingOther ? (
                <>
                  <button
                    onClick={handleOpenEdit}
                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Profile</span>
                  </button>
                  <button
                    onClick={() => {
                      logout();
                      onNavigate('login');
                    }}
                    className="px-3.5 py-2 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out</span>
                  </button>
                </>
              ) : (
                <>
                  {isFriend(user.id) ? (
                    <button
                      onClick={() => removeFriend(user.id)}
                      className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Friends (Remove)</span>
                    </button>
                  ) : hasPendingOutgoing(user.id) ? (
                    <button
                      disabled
                      className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-bold rounded-xl"
                    >
                      <span>Request Sent</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => sendFriendRequest(user.id)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Friend</span>
                    </button>
                  )}

                  <button
                    onClick={() => onNavigate('messages')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                {user.fullName}
              </h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                Verified JIT Member
              </span>
            </div>

            {/* Permanent Unique User ID with Copy */}
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-slate-500 font-mono">
                Permanent User ID: <code className="text-blue-600 dark:text-blue-400 font-bold">{user.id}</code>
              </p>
              <button
                onClick={handleCopyId}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title="Copy User ID"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 mt-2 max-w-2xl leading-relaxed">
              {user.bio || 'Proud member of JIT GROUP campus community.'}
            </p>

            {/* Privacy Badges & Metadata */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-3 text-xs text-slate-500">
              {/* Contact Number: Only show if public OR viewing own profile */}
              {(!isViewingOther || user.isContactNumberPublic) && (
                <div className="flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                  <span className="font-mono">{user.contactNumber}</span>
                  {!isViewingOther && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${user.isContactNumberPublic ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {user.isContactNumberPublic ? 'Public' : 'Private'}
                    </span>
                  )}
                </div>
              )}

              {/* Address: Only show if public OR viewing own profile */}
              {(!isViewingOther || user.isAddressPublic) && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{user.address}</span>
                  {!isViewingOther && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${user.isAddressPublic ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {user.isAddressPublic ? 'Public' : 'Private'}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Joined {new Date(user.joinedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-center">
              <p className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums">
                {user.stats?.friendsCount || 0}
              </p>
              <p className="text-[11px] font-semibold text-slate-500">Campus Friends</p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-center">
              <p className="text-lg font-black text-slate-900 dark:text-white font-mono tabular-nums">
                {user.stats?.gamesWon || 0} / {user.stats?.gamesPlayed || 0}
              </p>
              <p className="text-[11px] font-semibold text-slate-500">Game Victories</p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-center">
              <p className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                {user.stats?.rewardPoints || 100}
              </p>
              <p className="text-[11px] font-semibold text-slate-500">Virtual Points</p>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-center">
              <p className="text-lg font-black text-orange-600 dark:text-orange-400 font-mono tabular-nums">
                {user.stats?.streakDays || 1}d
              </p>
              <p className="text-[11px] font-semibold text-slate-500">Login Streak</p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Sub-tabs: Posts / Reels / Achievements */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('posts')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
            activeTab === 'posts'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Posts ({userPosts.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('reels')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
            activeTab === 'reels'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Video className="w-3.5 h-3.5" />
          <span>Reels ({userReels.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('achievements')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
            activeTab === 'achievements'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>Achievements</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'achievements' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INITIAL_ACHIEVEMENTS.map((ach) => (
            <div
              key={ach.id}
              className={`p-4 rounded-3xl border transition-all ${
                ach.isUnlocked
                  ? 'bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700/60 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2.5 rounded-2xl ${ach.isUnlocked ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                  <Trophy className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">{ach.title}</h4>
                  <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 font-mono">
                    +{ach.rewardPoints} Points
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {ach.description}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'posts' && (
        <div className="space-y-4">
          {userPosts.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl text-xs text-slate-400">
              No posts published yet.
            </div>
          ) : (
            userPosts.map((post) => (
              <div
                key={post.id}
                className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm"
              >
                <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">{post.content}</p>

                {post.mediaUrls && post.mediaUrls.length > 0 && (
                  <div className="mt-3 rounded-2xl overflow-hidden bg-black max-h-60 flex items-center justify-center">
                    {post.mediaType === 'video' ? (
                      <video src={post.mediaUrls[0]} controls className="max-h-60 w-auto object-contain" />
                    ) : (
                      <img src={post.mediaUrls[0]} alt="Post media" className="max-h-60 w-auto object-contain" />
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400">
                  <span>{post.createdAt}</span>
                  <span>·</span>
                  <span>{post.likesCount} likes</span>
                  <span>·</span>
                  <span>{post.commentsCount} comments</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'reels' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {userReels.length === 0 ? (
            <div className="col-span-full p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl text-xs text-slate-400">
              No reels created yet.
            </div>
          ) : (
            userReels.map((reel) => (
              <div
                key={reel.id}
                onClick={() => onNavigate('reels')}
                className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-black cursor-pointer group"
              >
                <video src={reel.videoUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2 text-white">
                  <p className="text-xs font-semibold line-clamp-1">{reel.caption}</p>
                  <p className="text-[10px] text-slate-300 font-mono">{reel.viewsCount} views</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Edit Profile Modal (Only for own profile) */}
      {showEditModal && !isViewingOther && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Edit Profile Details</h3>
              <button onClick={() => setShowEditModal(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Campus Bio</label>
                <textarea
                  rows={3}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Address / Hostel Location</label>
                <input
                  type="text"
                  required
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              {/* Photo Options in Edit Dialog */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Profile Photos</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenPhotoModal('avatar')}
                    className="p-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center gap-2.5 text-left transition-colors"
                  >
                    <img
                      src={currentUser?.avatarUrl || APP_CONFIG.logoUrl}
                      alt="Avatar Preview"
                      className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">Avatar</p>
                      <p className="text-[10px] text-slate-400 truncate">Update photo</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenPhotoModal('cover')}
                    className="p-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center gap-2.5 text-left transition-colors"
                  >
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
                      <Camera className="w-4 h-4" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">Cover</p>
                      <p className="text-[10px] text-slate-400 truncate">Update banner</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">Make Contact Number Public?</p>
                    <p className="text-[10px] text-slate-500">Default is private for account security</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isContactPublic}
                    onChange={(e) => setIsContactPublic(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">Make Address / Hostel Location Public?</p>
                    <p className="text-[10px] text-slate-500">Allow campus peers to see your address</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isAddressPublicState}
                    onChange={(e) => setIsAddressPublicState(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Photo Upload Modal (Profile Avatar & Cover Banner) */}
      <PhotoUploadModal
        isOpen={photoModalState.isOpen}
        onClose={() => setPhotoModalState((prev) => ({ ...prev, isOpen: false }))}
        mode={photoModalState.mode}
        currentPhotoUrl={
          photoModalState.mode === 'avatar'
            ? currentUser?.avatarUrl || APP_CONFIG.logoUrl
            : currentUser?.coverUrl
        }
        onSavePhoto={handleSavePhotoModal}
        onRemovePhoto={handleRemovePhotoModal}
      />
    </div>
  );
};
