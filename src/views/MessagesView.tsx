/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { Conversation, Message, CallType, CallStatus, NavTab, UserProfile } from '../types';
import { INITIAL_FRIENDS, INITIAL_USER } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import { saveMediaFile, VIDEO_EXPIRY_MS } from '../services/mediaStorage';
import { sendJitAiChat, JitAiChatTurn } from '../services/aiClient';
import { detectExpressBackendAvailable, safeFetchJson } from '../utils/safeFetch';
import {
  ChatMessageList,
  formatMessageTime,
  getMessageTime,
  sortMessagesChronologically,
} from '../components/chat/ChatMessageList';
import { ChatInputBar } from '../components/chat/ChatInputBar';
import { ChatStickerDef } from '../components/chat/chatStickersAndEmojis';
import {
  fetchPublicDirectory,
  searchCloudUsers,
  ensureFirestoreDirectConversation,
  createFirestoreGroupConversation,
  subscribeToFirestoreConversations,
  subscribeToFirestoreMessages,
  sendFirestoreDirectMessage,
  uploadVideoAssetToCloud,
  deriveUsername,
} from '../lib/firebase';
import {
  Phone,
  Video,
  Mic,
  MicOff,
  VideoOff,
  PhoneOff,
  Search,
  Plus,
  Users,
  MoreVertical,
  X,
  ArrowLeft,
  MessageSquarePlus,
  Loader2,
  LogIn,
  Sparkles,
  Bot,
  Trash2,
} from 'lucide-react';

interface MessagesViewProps {
  onNavigate: (tab: NavTab) => void;
}

const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv_001',
    type: 'direct',
    name: 'Priya Mukherjee',
    avatarUrl: INITIAL_FRIENDS[0].avatarUrl,
    participantIds: ['usr_jit_primary_001', 'usr_jit_002'],
    participantsMap: {
      usr_jit_primary_001: { name: INITIAL_USER.fullName, avatar: INITIAL_USER.avatarUrl },
      usr_jit_002: { name: INITIAL_FRIENDS[0].fullName, avatar: INITIAL_FRIENDS[0].avatarUrl },
    },
    lastMessage: {
      text: 'Are we still on for the Ludo tournament practice at 7 PM?',
      senderId: 'usr_jit_002',
      createdAt: '10:45 AM',
      isRead: false,
    },
    unreadCount: 1,
    updatedAt: '10:45 AM',
    updatedAtMs: 1,
  },
  {
    id: 'conv_002',
    type: 'direct',
    name: 'Arjun Verma',
    avatarUrl: INITIAL_FRIENDS[1].avatarUrl,
    participantIds: ['usr_jit_primary_001', 'usr_jit_003'],
    participantsMap: {
      usr_jit_primary_001: { name: INITIAL_USER.fullName, avatar: INITIAL_USER.avatarUrl },
      usr_jit_003: { name: INITIAL_FRIENDS[1].fullName, avatar: INITIAL_FRIENDS[1].avatarUrl },
    },
    lastMessage: {
      text: 'Sent you the room code for Carrom: JIT-4491',
      senderId: 'usr_jit_003',
      createdAt: 'Yesterday',
      isRead: true,
    },
    unreadCount: 0,
    updatedAt: 'Yesterday',
    updatedAtMs: 0,
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
    updatedAtMs: 0,
  },
];

const DEMO_BASE_MS = Date.now() - 30 * 60 * 1000;

interface ConversationRowProps {
  conv: Conversation;
  isSelected: boolean;
  onSelect: (convId: string) => void;
}

const ConversationRow: React.FC<ConversationRowProps> = React.memo(
  ({ conv, isSelected, onSelect }) => (
    <button
      onClick={() => onSelect(conv.id)}
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
            {conv.name || 'JIT Member'}
          </h4>
          <span className="text-[10px] text-slate-400 font-mono shrink-0">
            {conv.updatedAt}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 truncate">
          {conv.lastMessage?.text || 'Start chatting...'}
        </p>
      </div>

      {conv.unreadCount > 0 && (
        <span className="shrink-0 bg-blue-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center font-mono">
          {conv.unreadCount}
        </span>
      )}
    </button>
  )
);

ConversationRow.displayName = 'ConversationRow';

const DEMO_SEED_MESSAGES: Message[] = [
  {
    id: 'msg_1',
    conversationId: 'conv_001',
    senderId: 'usr_jit_002',
    senderName: 'Priya Mukherjee',
    content: 'Hi! Have you checked out the new JIT GROUP gaming and calling features?',
    createdAt: DEMO_BASE_MS,
    createdAtMs: DEMO_BASE_MS,
    createdAtLabel: '10:30 AM',
    status: 'read',
  },
  {
    id: 'msg_2',
    conversationId: 'conv_001',
    senderId: 'usr_jit_primary_001',
    senderName: 'Prof. Ramesh Sharma',
    content: 'Yes! The WebRTC low-latency calling and real-time state synchronization work seamlessly.',
    createdAt: DEMO_BASE_MS + 5 * 60 * 1000,
    createdAtMs: DEMO_BASE_MS + 5 * 60 * 1000,
    createdAtLabel: '10:35 AM',
    status: 'read',
  },
  {
    id: 'msg_3',
    conversationId: 'conv_001',
    senderId: 'usr_jit_002',
    senderName: 'Priya Mukherjee',
    content: 'Are we still on for the Ludo tournament practice at 7 PM?',
    createdAt: DEMO_BASE_MS + 15 * 60 * 1000,
    createdAtMs: DEMO_BASE_MS + 15 * 60 * 1000,
    createdAtLabel: '10:45 AM',
    status: 'delivered',
  },
];

export const MessagesView: React.FC<MessagesViewProps> = ({ onNavigate }) => {
  const { currentUser, registeredProfiles } = useAuth();
  const {
    activeChatPartner,
    clearActiveChatPartner,
    friendIds,
    friendRequestPeers,
  } = useSocial();

  const isPrimaryDemo = currentUser?.id === 'usr_jit_primary_001';

  const [cloudConversations, setCloudConversations] = useState<Conversation[]>([]);
  const [localConversations, setLocalConversations] = useState<Conversation[]>(() =>
    isPrimaryDemo ? DEMO_CONVERSATIONS : []
  );
  const [activeConvId, setActiveConvId] = useState<string>(() =>
    isPrimaryDemo ? 'conv_001' : ''
  );
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Modals: New DM & New Group
  const [isNewDmOpen, setIsNewDmOpen] = useState(false);
  const [dmUserQuery, setDmUserQuery] = useState('');
  const [directoryUsers, setDirectoryUsers] = useState<UserProfile[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [startingDmUserId, setStartingDmUserId] = useState<string | null>(null);

  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);

  // Messages state
  const [cloudMessages, setCloudMessages] = useState<Message[]>([]);
  const [localMessages, setLocalMessages] = useState<Message[]>(() =>
    isPrimaryDemo ? DEMO_SEED_MESSAGES : []
  );

  // JIT AI Chat Companion State
  const JIT_AI_CONV_ID = 'conv_jit_ai';
  const [aiMode, setAiMode] = useState<'general' | 'studies' | 'tech'>('general');
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [aiThinking, setAiThinking] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebRTC Call state
  const [activeCall, setActiveCall] = useState<{
    type: CallType;
    status: CallStatus;
    participantName: string;
    duration: number;
    isMuted: boolean;
    isVideoOff: boolean;
  } | null>(null);

  useEffect(() => {
    let interval: any = null;
    if (activeCall && activeCall.status === 'connected') {
      interval = setInterval(() => {
        setActiveCall((prev) => (prev ? { ...prev, duration: prev.duration + 1 } : null));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeCall?.status]);

  // Reset state smoothly when currentUser switches
  useEffect(() => {
    if (!currentUser?.id) {
      setCloudConversations([]);
      setLocalConversations([]);
      setCloudMessages([]);
      setActiveConvId('');
      return;
    }
    if (currentUser.id === 'usr_jit_primary_001') {
      setLocalConversations(DEMO_CONVERSATIONS);
      setLocalMessages(DEMO_SEED_MESSAGES);
      setActiveConvId((prev) => prev || 'conv_001');
    } else {
      setLocalConversations([]);
      setLocalMessages([]);
      setActiveConvId('');
    }
  }, [currentUser?.id]);

  // Load per-user JIT AI Companion conversation history
  useEffect(() => {
    if (!currentUser?.id) {
      setAiMessages([]);
      return;
    }
    try {
      const saved = localStorage.getItem(`jit_ai_chat_v1_${currentUser.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map((m: Message, idx: number) => {
            const ms = getMessageTime(m) || Date.now() - (parsed.length - idx) * 1000;
            return {
              ...m,
              createdAt: ms,
              createdAtMs: ms,
              createdAtLabel: formatMessageTime(m),
            };
          });
          setAiMessages(sortMessagesChronologically(normalized));
          return;
        }
      }
    } catch {
      // ignore storage error
    }
    const nowMs = Date.now();
    setAiMessages([
      {
        id: 'ai_welcome_1',
        conversationId: JIT_AI_CONV_ID,
        senderId: 'jit_ai_assistant',
        senderName: 'JIT AI Assistant',
        content: `Hi ${currentUser.fullName.split(' ')[0]}! I am JIT AI, your study, computer science, coding, and campus companion. Ask me anything anytime!`,
        createdAt: nowMs,
        createdAtMs: nowMs,
        createdAtLabel: 'Now',
        status: 'read',
      },
    ]);
  }, [currentUser?.id, currentUser?.fullName]);

  useEffect(() => {
    if (!currentUser?.id || aiMessages.length === 0) return;
    try {
      localStorage.setItem(`jit_ai_chat_v1_${currentUser.id}`, JSON.stringify(aiMessages.slice(-60)));
    } catch {
      // ignore quota
    }
  }, [aiMessages, currentUser?.id]);

  // Subscribe to real-time Firestore conversations for currentUser
  useEffect(() => {
    if (!currentUser?.id) return;
    const unsub = subscribeToFirestoreConversations(currentUser.id, (convs) => {
      setCloudConversations(convs);
      setActiveConvId((prev) => {
        if (prev === JIT_AI_CONV_ID) return prev;
        if (prev && (convs.some((c) => c.id === prev) || (isPrimaryDemo && prev.startsWith('conv_')))) {
          return prev;
        }
        return convs[0]?.id || (isPrimaryDemo ? 'conv_001' : JIT_AI_CONV_ID);
      });
    });
    return () => unsub();
  }, [currentUser?.id, isPrimaryDemo]);

  // Handle deep-linked DM target (`openDirectChat(partner)`)
  useEffect(() => {
    if (!activeChatPartner || !currentUser || activeChatPartner.id === currentUser.id) return;
    let cancelled = false;

    ensureFirestoreDirectConversation(currentUser, activeChatPartner)
      .then((conv) => {
        if (cancelled) return;
        setLocalConversations((prev) => {
          const filtered = prev.filter((c) => c.id !== conv.id);
          return [conv, ...filtered];
        });
        setActiveConvId(conv.id);
        setMobileThreadOpen(true);
        clearActiveChatPartner();
      })
      .catch((err) => {
        console.warn('Could not open direct conversation:', err);
        clearActiveChatPartner();
      });

    return () => {
      cancelled = true;
    };
  }, [activeChatPartner, currentUser, clearActiveChatPartner]);

  // Subscribe to real-time messages for active conversation
  useEffect(() => {
    setCloudMessages([]);
    if (!activeConvId || activeConvId === JIT_AI_CONV_ID) {
      return;
    }
    const unsub = subscribeToFirestoreMessages(activeConvId, (msgs) => {
      setCloudMessages(msgs);
    });
    return () => unsub();
  }, [activeConvId]);

  // Preload Express backend messages only when Express API is available (validates JSON content-type)
  useEffect(() => {
    if (!isPrimaryDemo) return;
    let active = true;
    (async () => {
      if (!(await detectExpressBackendAvailable())) return;
      const res = await safeFetchJson<{ conversations?: Conversation[]; messages?: Message[] }>('/api/messages');
      if (!active || !res.ok || !res.data) return;
      const data = res.data;
      if (Array.isArray(data.conversations) && data.conversations.length > 0) {
        setLocalConversations((prev) => {
          const map = new Map<string, Conversation>();
          data.conversations!.forEach((c: Conversation) => map.set(c.id, c));
          prev.forEach((c) => {
            if (!map.has(c.id)) map.set(c.id, c);
          });
          return Array.from(map.values());
        });
      }
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        const normalized = data.messages.map((m, idx) => {
          const ms = getMessageTime(m) || DEMO_BASE_MS + idx * 60_000;
          return {
            ...m,
            createdAt: ms,
            createdAtMs: ms,
            createdAtLabel: formatMessageTime(m),
          };
        });
        setLocalMessages(sortMessagesChronologically(normalized));
      }
    })();
    return () => {
      active = false;
    };
  }, [isPrimaryDemo]);

  // Load Firebase users directory when opening New DM or New Group modal
  useEffect(() => {
    if (!isNewDmOpen && !isNewGroupModalOpen) return;
    let cancelled = false;
    setLoadingDirectory(true);
    fetchPublicDirectory(120)
      .then((list) => {
        if (!cancelled) {
          setDirectoryUsers(list);
          setLoadingDirectory(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingDirectory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNewDmOpen, isNewGroupModalOpen]);

  // Live search in New DM modal
  useEffect(() => {
    if (!isNewDmOpen || !dmUserQuery.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchCloudUsers(dmUserQuery.trim(), 25)
        .then((res) => {
          if (!cancelled && res.length > 0) {
            setDirectoryUsers((prev) => {
              const map = new Map<string, UserProfile>();
              res.forEach((u) => map.set(u.id, u));
              prev.forEach((u) => {
                if (!map.has(u.id)) map.set(u.id, u);
              });
              return Array.from(map.values());
            });
          }
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isNewDmOpen, dmUserQuery]);

  const jitAiConversation: Conversation = useMemo(() => {
    const sortedAi = sortMessagesChronologically(aiMessages);
    const lastAiMsg = sortedAi[sortedAi.length - 1];
    return {
      id: JIT_AI_CONV_ID,
      type: 'direct',
      name: 'JIT AI Assistant',
      avatarUrl: APP_CONFIG.logoUrl,
      participantIds: ['jit_ai_assistant'],
      lastMessage: {
        text: lastAiMsg?.content?.slice(0, 70) || 'Ask studies, code, or campus questions anytime',
        senderId: lastAiMsg?.senderId || 'jit_ai_assistant',
        createdAt: lastAiMsg ? formatMessageTime(lastAiMsg) : 'Online',
        isRead: true,
      },
      unreadCount: 0,
      updatedAt: 'AI 24/7',
      updatedAtMs: Number.MAX_SAFE_INTEGER,
    };
  }, [aiMessages]);

  // Merge cloud + local conversations with dynamic partner resolution
  const conversations = useMemo(() => {
    const byId = new Map<string, Conversation>();
    for (const c of cloudConversations) {
      byId.set(c.id, c);
    }
    for (const lc of localConversations) {
      if (!byId.has(lc.id)) {
        byId.set(lc.id, lc);
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
    );
  }, [cloudConversations, localConversations]);

  const isAiThreadSelected = activeConvId === JIT_AI_CONV_ID;
  const activeConv = isAiThreadSelected
    ? jitAiConversation
    : conversations.find((c) => c.id === activeConvId) || jitAiConversation;

  const activeMessages = useMemo(() => {
    if (!activeConv) return [];
    if (activeConv.id === JIT_AI_CONV_ID) {
      return sortMessagesChronologically(aiMessages);
    }
    const byId = new Map<string, Message>();
    for (const lm of localMessages) {
      if (lm.conversationId === activeConv.id) {
        byId.set(lm.id, lm);
      }
    }
    for (const cm of cloudMessages) {
      if (cm.conversationId === activeConv.id) {
        byId.set(cm.id, cm);
      }
    }
    return sortMessagesChronologically(Array.from(byId.values()));
  }, [activeConv, cloudMessages, localMessages, aiMessages]);

  const lastActiveMessage = activeMessages[activeMessages.length - 1];
  const lastActiveMessageKey = lastActiveMessage
    ? `${lastActiveMessage.id}:${getMessageTime(lastActiveMessage)}`
    : '';

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeMessages.length, lastActiveMessageKey, activeConv?.id, mobileThreadOpen, aiThinking]);

  // Known peers pool for DM picker & Group member picker
  const selectablePeers = useMemo(() => {
    const all = [
      ...directoryUsers,
      ...friendRequestPeers,
      ...(registeredProfiles || []),
      INITIAL_USER,
      ...INITIAL_FRIENDS,
    ].filter(
      (u, idx, arr) =>
        u?.id &&
        u.id !== currentUser?.id &&
        u.status !== 'deleted' &&
        arr.findIndex((x) => x.id === u.id) === idx
    );

    // Put accepted friends first
    return all.sort((a, b) => {
      const aFriend = friendIds.includes(a.id) ? 1 : 0;
      const bFriend = friendIds.includes(b.id) ? 1 : 0;
      return bFriend - aFriend;
    });
  }, [directoryUsers, friendRequestPeers, registeredProfiles, currentUser?.id, friendIds]);

  const filteredDmPeers = useMemo(() => {
    const q = dmUserQuery.trim().toLowerCase().replace(/^@+/, '');
    if (!q) return selectablePeers;
    return selectablePeers.filter((u) => {
      const uname = (u.username || deriveUsername(u.fullName)).toLowerCase();
      return (
        u.fullName.toLowerCase().includes(q) ||
        uname.includes(q) ||
        (u.contactNumber || '').includes(q)
      );
    });
  }, [selectablePeers, dmUserQuery]);

  const handleStartDirectChat = async (peer: UserProfile) => {
    if (!currentUser) return;
    setStartingDmUserId(peer.id);
    try {
      const conv = await ensureFirestoreDirectConversation(currentUser, {
        id: peer.id,
        fullName: peer.fullName,
        avatarUrl: peer.avatarUrl,
      });
      setLocalConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      setActiveConvId(conv.id);
      setMobileThreadOpen(true);
      setIsNewDmOpen(false);
      setDmUserQuery('');
    } catch (err: any) {
      setSendError(err?.message || 'Unable to start direct conversation.');
    } finally {
      setStartingDmUserId(null);
    }
  };

  const sendPromptToJitAi = useCallback(
    async (promptText: string) => {
      if (!promptText.trim() || !currentUser || aiThinking) return;
      const clean = promptText.trim();
      const userCreatedAt = Date.now();
      const nowTime = new Date(userCreatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const userMsg: Message = {
        id: `ai_u_${userCreatedAt}`,
        conversationId: JIT_AI_CONV_ID,
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        type: 'text',
        content: clean,
        createdAt: userCreatedAt,
        createdAtMs: userCreatedAt,
        createdAtLabel: nowTime,
        status: 'read',
      };

      const historyTurns: JitAiChatTurn[] = sortMessagesChronologically(aiMessages)
        .filter((m) => !m.id.startsWith('ai_welcome_') && m.type !== 'sticker')
        .slice(-10)
        .map((m) => ({
          role: m.senderId === currentUser.id ? 'user' : 'model',
          text: m.content,
        }));

      setAiMessages((prev) => sortMessagesChronologically([...prev, userMsg]));
      setAiThinking(true);
      setSendError(null);

      try {
        const res = await sendJitAiChat({
          message: clean,
          history: historyTurns,
          userName: currentUser.fullName,
          mode: aiMode,
        });

        const replyCreatedAt = Math.max(Date.now(), userCreatedAt + 1);
        const replyMsg: Message = {
          id: `ai_m_${replyCreatedAt}_${Math.random().toString(36).slice(2, 5)}`,
          conversationId: JIT_AI_CONV_ID,
          senderId: 'jit_ai_assistant',
          senderName: 'JIT AI Assistant',
          type: 'text',
          content: res.reply,
          createdAt: replyCreatedAt,
          createdAtMs: replyCreatedAt,
          createdAtLabel: new Date(replyCreatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          status: 'read',
        };
        setAiMessages((prev) => sortMessagesChronologically([...prev, replyMsg]));
      } catch (err: any) {
        setSendError(err?.message || 'Unable to reach JIT AI right now.');
      } finally {
        setAiThinking(false);
      }
    },
    [currentUser, aiThinking, aiMessages, aiMode]
  );

  const handleSendMessage = useCallback(
    async (contentToSend: string, fileToSend: File | null): Promise<boolean> => {
      if ((!contentToSend.trim() && !fileToSend) || !currentUser || !activeConv) return false;

      if (activeConv.id === JIT_AI_CONV_ID) {
        const prompt = contentToSend.trim();
        if (!prompt) return false;
        await sendPromptToJitAi(prompt);
        return true;
      }

      setSendError(null);
      setSendingMessage(true);

      let mediaUrl: string | undefined;
      let mediaType: 'image' | 'video' | 'file' | undefined;

      if (fileToSend) {
        try {
          if (fileToSend.type.startsWith('video/')) {
            const uploaded = await uploadVideoAssetToCloud(
              currentUser.id,
              fileToSend,
              '',
              Date.now() + VIDEO_EXPIRY_MS
            );
            mediaUrl = uploaded.videoUrl;
            mediaType = 'video';
          } else {
            const { dataUrl } = await saveMediaFile(fileToSend);
            mediaUrl = dataUrl;
            mediaType = fileToSend.type.startsWith('image/') ? 'image' : 'file';
          }
        } catch (err: any) {
          setSendError(err?.message || 'Failed to process attached media');
          setSendingMessage(false);
          return false;
        }
      }

      const nowMs = Date.now();
      const timeLabel = new Date(nowMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const optimisticId = `msg_${nowMs}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);
      const resolvedType: Message['type'] = mediaUrl ? mediaType || 'image' : 'text';

      const optimisticMsg: Message = {
        id: optimisticId,
        conversationId: activeConv.id,
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        senderAvatar: currentUser.avatarUrl,
        type: resolvedType,
        content: contentToSend.trim(),
        mediaUrl,
        mediaType,
        createdAt: nowMs,
        createdAtMs: nowMs,
        createdAtLabel: timeLabel,
        status: 'sent',
      };

      setLocalMessages((prev) =>
        prev.some((m) => m.id === optimisticId)
          ? prev
          : sortMessagesChronologically([...prev, optimisticMsg])
      );

      try {
        const sentMsg = await sendFirestoreDirectMessage(activeConv, currentUser, {
          id: optimisticId,
          createdAtMs: nowMs,
          type: resolvedType,
          content: contentToSend.trim(),
          mediaUrl,
          mediaType,
        });

        const sentTimeLabel = formatMessageTime(sentMsg);
        setLocalMessages((prev) =>
          sortMessagesChronologically(
            prev.map((m) => (m.id === sentMsg.id ? sentMsg : m))
          )
        );
        setLocalConversations((prev) =>
          prev.map((c) =>
            c.id === activeConv.id
              ? {
                  ...c,
                  lastMessage: {
                    text: sentMsg.content || (mediaUrl ? '[Media Attachment]' : ''),
                    senderId: currentUser.id,
                    createdAt: sentTimeLabel,
                    isRead: true,
                  },
                  updatedAt: sentTimeLabel,
                  updatedAtMs: getMessageTime(sentMsg) || nowMs,
                }
              : c
          )
        );

        detectExpressBackendAvailable()
          .then((hasBackend) => {
            if (!hasBackend) return;
            return fetch('/api/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: sentMsg }),
            });
          })
          .catch(() => {});
        return true;
      } catch (err: any) {
        setLocalMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setSendError(err?.message || 'Message failed to send. Please check connection and retry.');
        return false;
      } finally {
        setSendingMessage(false);
      }
    },
    [currentUser, activeConv, sendPromptToJitAi]
  );

  const handleSendSticker = useCallback(
    async (sticker: ChatStickerDef) => {
      if (!currentUser || !activeConv) return;
      const nowMs = Date.now();
      const timeLabel = new Date(nowMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const optimisticId = `msg_${nowMs}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 120);

      const stickerMsg: Message = {
        id: optimisticId,
        conversationId: activeConv.id,
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        senderAvatar: currentUser.avatarUrl,
        type: 'sticker',
        stickerId: sticker.id,
        stickerData: sticker.id,
        content: '',
        createdAt: nowMs,
        createdAtMs: nowMs,
        createdAtLabel: timeLabel,
        status: activeConv.id === JIT_AI_CONV_ID ? 'read' : 'sent',
      };

      if (activeConv.id === JIT_AI_CONV_ID) {
        setAiMessages((prev) => sortMessagesChronologically([...prev, stickerMsg]));
        return;
      }

      setSendError(null);
      setLocalMessages((prev) =>
        prev.some((m) => m.id === optimisticId)
          ? prev
          : sortMessagesChronologically([...prev, stickerMsg])
      );

      try {
        const sentMsg = await sendFirestoreDirectMessage(activeConv, currentUser, {
          id: optimisticId,
          createdAtMs: nowMs,
          type: 'sticker',
          content: '',
          stickerId: sticker.id,
          stickerData: sticker.id,
        });

        const sentTimeLabel = formatMessageTime(sentMsg);
        setLocalMessages((prev) =>
          sortMessagesChronologically(
            prev.map((m) => (m.id === sentMsg.id ? sentMsg : m))
          )
        );
        setLocalConversations((prev) =>
          prev.map((c) =>
            c.id === activeConv.id
              ? {
                  ...c,
                  lastMessage: {
                    text: `[Sticker: ${sticker.label}]`,
                    senderId: currentUser.id,
                    createdAt: sentTimeLabel,
                    isRead: true,
                  },
                  updatedAt: sentTimeLabel,
                  updatedAtMs: getMessageTime(sentMsg) || nowMs,
                }
              : c
          )
        );
      } catch (err: any) {
        setLocalMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setSendError(err?.message || 'Sticker failed to send. Please check connection and retry.');
      }
    },
    [currentUser, activeConv]
  );

  const handleSelectConversation = useCallback((convId: string) => {
    setActiveConvId(convId);
    setMobileThreadOpen(true);
  }, []);

  const handleClearSendError = useCallback(() => {
    setSendError(null);
  }, []);

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

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !currentUser) return;

    const participantsMap: Record<string, { name: string; avatar?: string }> = {
      [currentUser.id]: { name: currentUser.fullName, avatar: currentUser.avatarUrl },
    };
    selectedGroupMembers.forEach((mid) => {
      const peer = selectablePeers.find((p) => p.id === mid);
      if (peer) {
        participantsMap[mid] = { name: peer.fullName, avatar: peer.avatarUrl };
      }
    });

    try {
      const newConv = await createFirestoreGroupConversation(
        currentUser,
        newGroupName.trim(),
        selectedGroupMembers,
        participantsMap
      );
      setLocalConversations((prev) => [newConv, ...prev]);
      setActiveConvId(newConv.id);
      setMobileThreadOpen(true);
      setNewGroupName('');
      setSelectedGroupMembers([]);
      setIsNewGroupModalOpen(false);

      detectExpressBackendAvailable()
        .then((hasBackend) => {
          if (!hasBackend) return;
          return fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation: newConv }),
          });
        })
        .catch(() => {});
    } catch (err: any) {
      setSendError(err?.message || 'Failed to create group chat.');
    }
  };

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto py-14 px-6 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <MessageSquarePlus className="w-12 h-12 text-blue-600 mx-auto" />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          Sign In to Message Campus Friends
        </h3>
        <p className="text-xs text-slate-500">
          Log in with your JIT GROUP account to send direct messages and start group chats in real time.
        </p>
        <button
          onClick={() => onNavigate('login')}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs inline-flex items-center gap-1.5"
        >
          <LogIn className="w-4 h-4" />
          <span>Sign In</span>
        </button>
      </div>
    );
  }

  const filteredConversations = conversations.filter((c) =>
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden h-[calc(100dvh-132px)] sm:h-[calc(100vh-140px)] min-h-[460px] flex">
      {/* 1. Left Conversation List */}
      <div
        className={`w-full sm:w-80 md:w-96 border-r border-slate-100 dark:border-slate-800 ${
          mobileThreadOpen ? 'hidden sm:flex' : 'flex'
        } flex-col shrink-0`}
      >
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Chats &amp; Groups
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsNewDmOpen(true)}
                className="px-2.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-1 shadow-sm"
                title="Start New Direct Message"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>New DM</span>
              </button>
              <button
                onClick={() => setIsNewGroupModalOpen(true)}
                className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-xl transition-colors"
                title="Create New Group"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
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
          {/* Pinned JIT AI Chat Companion */}
          {(!searchQuery.trim() ||
            'jit ai assistant study helper tech'.includes(searchQuery.toLowerCase())) && (
            <button
              key={JIT_AI_CONV_ID}
              onClick={() => {
                setActiveConvId(JIT_AI_CONV_ID);
                setMobileThreadOpen(true);
              }}
              className={`w-full p-3.5 flex items-start gap-3 text-left transition-colors ${
                activeConv?.id === JIT_AI_CONV_ID
                  ? 'bg-indigo-50/90 dark:bg-indigo-950/40'
                  : 'bg-indigo-50/30 dark:bg-indigo-950/10 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30'
              }`}
            >
              <div className="relative shrink-0 w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-white flex items-center justify-center shadow-sm">
                <Bot className="w-5 h-5" />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h4 className="text-xs font-extrabold text-indigo-950 dark:text-white truncate">
                      JIT AI Assistant
                    </h4>
                    <span className="px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-[9px] font-bold uppercase tracking-wider shrink-0">
                      AI
                    </span>
                  </div>
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono shrink-0">
                    24/7
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                  {jitAiConversation.lastMessage?.text}
                </p>
              </div>
            </button>
          )}

          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <MessageSquarePlus className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-xs text-slate-500">
                No conversations yet. Start a direct chat with a campus friend!
              </p>
              <button
                onClick={() => setIsNewDmOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
              >
                Start Direct Message
              </button>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                conv={conv}
                isSelected={conv.id === activeConv?.id}
                onSelect={handleSelectConversation}
              />
            ))
          )}
        </div>
      </div>

      {/* 2. Active Chat Thread */}
      <div
        className={`${
          mobileThreadOpen ? 'flex' : 'hidden sm:flex'
        } flex-1 flex-col justify-between bg-slate-50/40 dark:bg-slate-950/20`}
      >
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
            <MessageSquarePlus className="w-12 h-12 text-blue-500/80" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Select a conversation or start a New DM
            </h4>
            <p className="text-xs text-slate-500 max-w-xs">
              Real-time personal messaging synced with Firebase Firestore across all your devices.
            </p>
            <button
              onClick={() => setIsNewDmOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
            >
              Message a Friend
            </button>
          </div>
        ) : (
          <>
            {/* Thread Header */}
            <div className="p-3.5 px-4 sm:px-5 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => setMobileThreadOpen(false)}
                  className="sm:hidden p-1.5 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors shrink-0"
                  title="Back to conversations"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                {activeConv.id === JIT_AI_CONV_ID ? (
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Sparkles className="w-5 h-5" />
                  </div>
                ) : (
                  <img
                    src={activeConv.avatarUrl || APP_CONFIG.logoUrl}
                    alt={activeConv.name}
                    className="w-10 h-10 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {activeConv.name}
                  </h4>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium truncate">
                    {activeConv.id === JIT_AI_CONV_ID
                      ? 'JIT AI Companion · Studies, Code & General Chat'
                      : 'Real-Time Sync Active · Free Personal & Group DM'}
                  </p>
                </div>
              </div>

              {activeConv.id === JIT_AI_CONV_ID ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="hidden sm:flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl">
                    {(['general', 'studies', 'tech'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setAiMode(m)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold capitalize transition-colors ${
                          aiMode === m
                            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nowMs = Date.now();
                      setAiMessages([
                        {
                          id: `ai_welcome_${nowMs}`,
                          conversationId: JIT_AI_CONV_ID,
                          senderId: 'jit_ai_assistant',
                          senderName: 'JIT AI Assistant',
                          type: 'text',
                          content:
                            'Fresh chat started! Ask me about Computer Science, exams, coding errors, or general questions.',
                          createdAt: nowMs,
                          createdAtMs: nowMs,
                          createdAtLabel: 'Now',
                          status: 'read',
                        },
                      ]);
                      setSendError(null);
                    }}
                    className="p-2 text-slate-400 hover:text-red-500 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Clear AI Chat History"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* WebRTC Calling Actions */
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
              )}
            </div>

            {/* Memoized Message Bubble & Sticker Feed */}
            <ChatMessageList
              messages={activeMessages}
              currentUserId={currentUser.id}
              activeConvId={activeConv.id}
              activeConvName={activeConv.name || 'Friend'}
              isAiThread={activeConv.id === JIT_AI_CONV_ID}
              aiThinking={aiThinking}
              onPromptChipClick={sendPromptToJitAi}
              messagesEndRef={messagesEndRef}
            />

            {/* Isolated Chat Input Bar + Emoji & Sticker Picker */}
            <ChatInputBar
              activeConvId={activeConv.id}
              isAiThread={activeConv.id === JIT_AI_CONV_ID}
              sendingMessage={sendingMessage}
              aiThinking={aiThinking}
              externalError={sendError}
              onClearExternalError={handleClearSendError}
              onSendMessage={handleSendMessage}
              onSendSticker={handleSendSticker}
            />
          </>
        )}
      </div>

      {/* 3. WebRTC Active Calling Modal Screen */}
      {activeCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 animate-in fade-in">
          <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-slate-900 text-white rounded-3xl p-5 sm:p-6 flex flex-col items-center justify-between min-h-[400px] sm:min-h-[460px] border border-slate-800 shadow-2xl">
            <div className="flex flex-col items-center mt-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 mb-1">
                {activeCall.type === 'video' ? 'WebRTC HD Video Call' : 'WebRTC HD Voice Call'}
              </span>
              <h3 className="text-lg font-bold">{activeCall.participantName}</h3>
              <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
                {activeCall.status === 'calling'
                  ? 'Connecting audio/video stream...'
                  : `Call Active · ${formatDuration(activeCall.duration)}`}
              </p>
            </div>

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

            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={() =>
                  setActiveCall((prev) => (prev ? { ...prev, isMuted: !prev.isMuted } : null))
                }
                className={`p-3.5 rounded-2xl transition-colors ${
                  activeCall.isMuted
                    ? 'bg-red-500 text-white'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                title={activeCall.isMuted ? 'Unmute' : 'Mute'}
              >
                {activeCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {activeCall.type === 'video' && (
                <button
                  onClick={() =>
                    setActiveCall((prev) =>
                      prev ? { ...prev, isVideoOff: !prev.isVideoOff } : null
                    )
                  }
                  className={`p-3.5 rounded-2xl transition-colors ${
                    activeCall.isVideoOff
                      ? 'bg-red-500 text-white'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                  title={activeCall.isVideoOff ? 'Enable Camera' : 'Disable Camera'}
                >
                  {activeCall.isVideoOff ? (
                    <VideoOff className="w-5 h-5" />
                  ) : (
                    <Video className="w-5 h-5" />
                  )}
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

      {/* Start New Direct Message Modal */}
      {isNewDmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 animate-in fade-in">
          <div className="w-full max-w-md max-h-[85dvh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
                  <MessageSquarePlus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Start Direct Message
                </h3>
              </div>
              <button
                onClick={() => setIsNewDmOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                autoFocus
                placeholder="Search any registered user by name or @username..."
                value={dmUserQuery}
                onChange={(e) => setDmUserQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-72">
              {loadingDirectory && filteredDmPeers.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Loading JIT members...</span>
                </div>
              ) : filteredDmPeers.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No matching members found.
                </div>
              ) : (
                filteredDmPeers.map((peer) => {
                  const isConnectedFriend = friendIds.includes(peer.id);
                  return (
                    <button
                      key={peer.id}
                      type="button"
                      disabled={startingDmUserId === peer.id}
                      onClick={() => handleStartDirectChat(peer)}
                      className="w-full p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 hover:bg-blue-50 dark:hover:bg-blue-950/30 flex items-center justify-between gap-2 text-left transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={peer.avatarUrl || APP_CONFIG.logoUrl}
                          alt={peer.fullName}
                          className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {peer.fullName}
                            </p>
                            {isConnectedFriend && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400">
                                Friend
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono text-slate-500 truncate">
                            @{peer.username || deriveUsername(peer.fullName)}
                          </p>
                        </div>
                      </div>
                      {startingDmUserId === peer.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                      ) : (
                        <span className="px-2.5 py-1 rounded-xl bg-blue-600 text-white text-[10px] font-bold shrink-0">
                          Message
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create New Group Chat Modal */}
      {isNewGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 animate-in fade-in">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Create Campus Group Chat
                </h3>
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Group Name
                </label>
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
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Select Members
                </label>
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {selectablePeers.map((friend) => {
                    const isChecked = selectedGroupMembers.includes(friend.id);
                    return (
                      <label
                        key={friend.id}
                        className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <img
                            src={friend.avatarUrl || APP_CONFIG.logoUrl}
                            alt={friend.fullName}
                            className="w-7 h-7 rounded-full object-cover"
                          />
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {friend.fullName}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGroupMembers((prev) => [...prev, friend.id]);
                            } else {
                              setSelectedGroupMembers((prev) =>
                                prev.filter((id) => id !== friend.id)
                              );
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
