/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Conversation, Message, CallType, CallStatus, NavTab } from '../types';
import { INITIAL_FRIENDS } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import { saveMediaFile, validateMediaFile } from '../services/mediaStorage';
import {
  Send,
  Phone,
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  Smile,
  Paperclip,
  Search,
  CheckCheck,
  Check,
  Plus,
  Users,
  MoreVertical,
  ShieldCheck,
  X,
  Image as ImageIcon,
  ArrowLeft,
} from 'lucide-react';

interface MessagesViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ onNavigate }) => {
  const { currentUser } = useAuth();

  // Conversations List
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: 'conv_001',
      type: 'direct',
      name: 'Priya Mukherjee',
      avatarUrl: INITIAL_FRIENDS[0].avatarUrl,
      participantIds: ['usr_jit_primary_001', 'usr_jit_002'],
      lastMessage: {
        text: 'Are we still on for the Ludo tournament practice at 7 PM?',
        senderId: 'usr_jit_002',
        createdAt: '10:45 AM',
        isRead: false,
      },
      unreadCount: 1,
      updatedAt: '10:45 AM',
    },
    {
      id: 'conv_002',
      type: 'direct',
      name: 'Arjun Verma',
      avatarUrl: INITIAL_FRIENDS[1].avatarUrl,
      participantIds: ['usr_jit_primary_001', 'usr_jit_003'],
      lastMessage: {
        text: 'Sent you the room code for Carrom: JIT-4491',
        senderId: 'usr_jit_003',
        createdAt: 'Yesterday',
        isRead: true,
      },
      unreadCount: 0,
      updatedAt: 'Yesterday',
    },
    {
      id: 'conv_003',
      type: 'group',
      name: 'JIT Tech Club & Gamers',
      avatarUrl: APP_CONFIG.logoUrl,
      participantIds: ['usr_jit_primary_001', 'usr_jit_002', 'usr_jit_003'],
      lastMessage: {
        text: 'Ananya: Chess blitz registration closes tonight!',
        senderId: 'usr_jit_004',
        createdAt: '2 days ago',
        isRead: true,
      },
      unreadCount: 0,
      updatedAt: '2 days ago',
    },
  ]);

  const [activeConvId, setActiveConvId] = useState<string>('conv_001');
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageText, setMessageText] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([INITIAL_FRIENDS[0].id]);
  const [attachError, setAttachError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Messages in active thread
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg_1',
      conversationId: 'conv_001',
      senderId: 'usr_jit_002',
      senderName: 'Priya Mukherjee',
      content: 'Hi! Have you checked out the new JIT GROUP gaming and calling features?',
      createdAt: '10:30 AM',
      status: 'read',
    },
    {
      id: 'msg_2',
      conversationId: 'conv_001',
      senderId: 'usr_jit_primary_001',
      senderName: 'Prof. Ramesh Sharma',
      content: 'Yes! The WebRTC low-latency calling and real-time state synchronization work seamlessly.',
      createdAt: '10:35 AM',
      status: 'read',
    },
    {
      id: 'msg_3',
      conversationId: 'conv_001',
      senderId: 'usr_jit_002',
      senderName: 'Priya Mukherjee',
      content: 'Are we still on for the Ludo tournament practice at 7 PM?',
      createdAt: '10:45 AM',
      status: 'delivered',
    },
  ]);

  // WebRTC Call state
  const [activeCall, setActiveCall] = useState<{
    type: CallType;
    status: CallStatus;
    participantName: string;
    duration: number;
    isMuted: boolean;
    isVideoOff: boolean;
  } | null>(null);

  // Call timer effect
  useEffect(() => {
    let interval: any = null;
    if (activeCall && activeCall.status === 'connected') {
      interval = setInterval(() => {
        setActiveCall((prev) => (prev ? { ...prev, duration: prev.duration + 1 } : null));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeCall?.status]);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAttachError(null);
    const validation = validateMediaFile(file, { maxSizeMb: 15 });
    if (!validation.valid) {
      setAttachError(validation.error || 'Invalid file');
      return;
    }

    setAttachedFile(file);
    setAttachedPreview(URL.createObjectURL(file));
  };

  const clearAttachment = () => {
    if (attachedPreview && attachedPreview.startsWith('blob:')) {
      URL.revokeObjectURL(attachedPreview);
    }
    setAttachedFile(null);
    setAttachedPreview(null);
    setAttachError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!messageText.trim() && !attachedFile) || !currentUser) return;

    let mediaUrl: string | undefined;
    let mediaType: 'image' | 'video' | 'file' | undefined;

    if (attachedFile) {
      try {
        const { dataUrl } = await saveMediaFile(attachedFile);
        mediaUrl = dataUrl;
        mediaType = attachedFile.type.startsWith('image/') ? 'image' : 'file';
      } catch {
        setAttachError('Failed to save attached media');
        return;
      }
    }

    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      conversationId: activeConvId,
      senderId: currentUser.id,
      senderName: currentUser.fullName,
      content: messageText.trim(),
      mediaUrl,
      mediaType,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'delivered',
    };

    setMessages((prev) => [...prev, newMsg]);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvId
          ? {
              ...c,
              lastMessage: {
                text: newMsg.content || (mediaUrl ? '[Image Attachment]' : ''),
                senderId: currentUser.id,
                createdAt: newMsg.createdAt,
                isRead: true,
              },
            }
          : c
      )
    );
    setMessageText('');
    clearAttachment();
  };

  const startCall = (type: CallType) => {
    setActiveCall({
      type,
      status: 'calling',
      participantName: activeConv?.name || 'Contact',
      duration: 0,
      isMuted: false,
      isVideoOff: false,
    });

    setTimeout(() => {
      setActiveCall((prev) => (prev ? { ...prev, status: 'connected' } : null));
    }, 1500);
  };

  const endCall = () => {
    setActiveCall(null);
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainder = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !currentUser) return;
    const newConvId = `conv_grp_${Date.now()}`;
    const newConv: Conversation = {
      id: newConvId,
      type: 'group',
      name: newGroupName.trim(),
      avatarUrl: APP_CONFIG.logoUrl,
      participantIds: [currentUser.id, ...selectedGroupMembers],
      lastMessage: {
        text: 'Group created. Welcome to JIT Group Chat!',
        senderId: currentUser.id,
        createdAt: 'Just now',
        isRead: true,
      },
      unreadCount: 0,
      updatedAt: 'Just now',
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConvId);
    setMobileThreadOpen(true);
    setNewGroupName('');
    setIsNewGroupModalOpen(false);
  };

  const filteredConversations = conversations.filter((c) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden h-[calc(100dvh-140px)] sm:h-[calc(100vh-140px)] min-h-[520px] flex">
      {/* 1. Left Conversation List */}
      <div className={`w-full sm:w-80 md:w-96 border-r border-slate-100 dark:border-slate-800 ${mobileThreadOpen ? 'hidden sm:flex' : 'flex'} flex-col shrink-0`}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Chats & Groups
            </h3>
            <button
              onClick={() => setIsNewGroupModalOpen(true)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-xl transition-colors"
              title="Create New Group"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 no-scrollbar">
          {filteredConversations.map((conv) => {
            const isSelected = conv.id === activeConvId;
            return (
              <button
                key={conv.id}
                onClick={() => {
                  setActiveConvId(conv.id);
                  setMobileThreadOpen(true);
                }}
                className={`w-full p-3.5 flex items-start gap-3 text-left transition-colors ${
                  isSelected
                    ? 'bg-blue-50/70 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="relative shrink-0">
                  <img
                    src={conv.avatarUrl || APP_CONFIG.logoUrl}
                    alt={conv.name}
                    className="w-11 h-11 rounded-2xl object-cover border border-slate-200 dark:border-slate-700"
                  />
                  {conv.type === 'group' && (
                    <div className="absolute -bottom-1 -right-1 p-0.5 bg-blue-600 text-white rounded-md">
                      <Users className="w-2.5 h-2.5" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {conv.name}
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {conv.updatedAt}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">
                    {conv.lastMessage?.text || 'No messages yet'}
                  </p>
                </div>

                {conv.unreadCount > 0 && (
                  <span className="shrink-0 bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center font-mono">
                    {conv.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Active Chat Thread */}
      <div className={`${mobileThreadOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col justify-between bg-slate-50/40 dark:bg-slate-950/20`}>
        {/* Thread Header */}
        <div className="p-3.5 px-4 sm:px-5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setMobileThreadOpen(false)}
              className="sm:hidden p-1.5 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors shrink-0"
              title="Back to conversations"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <img
              src={activeConv?.avatarUrl || APP_CONFIG.logoUrl}
              alt={activeConv?.name}
              className="w-10 h-10 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {activeConv?.name}
              </h4>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate">
                Active in JIT Network
              </p>
            </div>
          </div>

          {/* WebRTC Calling Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => startCall('voice')}
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              title="Start WebRTC Voice Call"
            >
              <Phone className="w-4 h-4" />
            </button>
            <button
              onClick={() => startCall('video')}
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              title="Start WebRTC HD Video Call"
            >
              <Video className="w-4 h-4" />
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Message Bubble Feed */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 no-scrollbar">
          <div className="flex justify-center my-2">
            <span className="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-3 py-1 rounded-full flex items-center gap-1.5 border border-slate-200 dark:border-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
              <span>Local Demo Mode · Chat and media persisted with IndexedDB</span>
            </span>
          </div>

          {messages.map((msg) => {
            const isMe = msg.senderId === currentUser?.id;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl p-3 text-xs leading-relaxed ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-tr-sm shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm'
                  }`}
                >
                  {!isMe && (
                    <p className="text-[10px] font-bold text-blue-500 mb-0.5">
                      {msg.senderName}
                    </p>
                  )}

                  {/* Attached Media */}
                  {msg.mediaUrl && (
                    <div className="mb-2 rounded-xl overflow-hidden bg-black/20">
                      <img
                        src={msg.mediaUrl}
                        alt="Attachment"
                        className="max-h-48 w-auto rounded-xl object-contain"
                      />
                    </div>
                  )}

                  {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
                  <span>{msg.createdAt}</span>
                  {isMe && (
                    <span>
                      {msg.status === 'read' ? (
                        <CheckCheck className="w-3 h-3 text-blue-500 inline" />
                      ) : (
                        <Check className="w-3 h-3 text-slate-400 inline" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Attachment preview if user picked a file */}
        {attachedPreview && (
          <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src={attachedPreview}
                alt="Upload preview"
                className="w-10 h-10 rounded-lg object-cover border border-slate-300 dark:border-slate-600"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                {attachedFile?.name}
              </span>
            </div>
            <button
              onClick={clearAttachment}
              className="p-1 text-slate-400 hover:text-red-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {attachError && (
          <div className="px-4 py-1 text-xs text-red-500 bg-red-50 dark:bg-red-950/40">
            {attachError}
          </div>
        )}

        {/* Message Input Bar */}
        <form onSubmit={handleSendMessage} className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Attach Image"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileAttach}
            accept="image/*"
            className="hidden"
          />

          <input
            type="text"
            placeholder="Type your message..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            className="flex-1 px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!messageText.trim() && !attachedFile}
            className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl shadow-sm transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* 3. WebRTC Active Calling Modal Screen */}
      {activeCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="relative w-full max-w-md bg-slate-900 text-white rounded-3xl p-6 flex flex-col items-center justify-between min-h-[460px] border border-slate-800 shadow-2xl">
            {/* Top info */}
            <div className="flex flex-col items-center mt-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 mb-1">
                {activeCall.type === 'video' ? 'WebRTC HD Video Call' : 'WebRTC HD Voice Call'}
              </span>
              <h3 className="text-lg font-bold">{activeCall.participantName}</h3>
              <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
                {activeCall.status === 'calling'
                  ? 'Simulating audio/video stream setup...'
                  : `Preview Active · ${formatDuration(activeCall.duration)} (Live remote call requires signaling server)`}
              </p>
            </div>

            {/* Video preview / Avatar pulse */}
            <div className="relative my-8">
              {activeCall.type === 'video' && !activeCall.isVideoOff ? (
                <div className="w-48 h-48 rounded-3xl bg-slate-800 border-2 border-blue-500/40 flex items-center justify-center overflow-hidden shadow-xl">
                  <div className="text-center p-4">
                    <Video className="w-10 h-10 text-blue-400 mx-auto mb-2 animate-pulse" />
                    <p className="text-xs text-slate-300">Live Peer Stream Active</p>
                  </div>
                </div>
              ) : (
                <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-blue-600 to-emerald-500 p-1 flex items-center justify-center animate-pulse">
                  <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
                    <Users className="w-12 h-12 text-blue-400" />
                  </div>
                </div>
              )}
            </div>

            {/* In-Call Controls */}
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={() =>
                  setActiveCall((prev) => (prev ? { ...prev, isMuted: !prev.isMuted } : null))
                }
                className={`p-3.5 rounded-2xl transition-colors ${
                  activeCall.isMuted ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                title={activeCall.isMuted ? 'Unmute' : 'Mute'}
              >
                {activeCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {activeCall.type === 'video' && (
                <button
                  onClick={() =>
                    setActiveCall((prev) => (prev ? { ...prev, isVideoOff: !prev.isVideoOff } : null))
                  }
                  className={`p-3.5 rounded-2xl transition-colors ${
                    activeCall.isVideoOff ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                  title={activeCall.isVideoOff ? 'Enable Camera' : 'Disable Camera'}
                >
                  {activeCall.isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}

              <button
                onClick={endCall}
                className="p-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30 transition-colors"
                title="End Call"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Group Chat Modal */}
      {isNewGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create Campus Group Chat</h3>
              </div>
              <button
                onClick={() => setIsNewGroupModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Group Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. JIT Robotics League"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Select Members</label>
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {INITIAL_FRIENDS.map((friend) => {
                    const isChecked = selectedGroupMembers.includes(friend.id);
                    return (
                      <label
                        key={friend.id}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <img
                            src={friend.avatarUrl}
                            alt={friend.fullName}
                            className="w-7 h-7 rounded-full object-cover"
                          />
                          <span className="font-medium text-slate-800 dark:text-slate-200">{friend.fullName}</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGroupMembers((prev) => [...prev, friend.id]);
                            } else {
                              setSelectedGroupMembers((prev) => prev.filter((id) => id !== friend.id));
                            }
                          }}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewGroupModalOpen(false)}
                  className="flex-1 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newGroupName.trim()}
                  className="flex-1 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
