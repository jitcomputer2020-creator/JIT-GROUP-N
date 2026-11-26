/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Message } from '../../types';
import { ResponsiveImage } from '../common/ResponsiveImage';
import { ResilientVideo } from '../common/ResilientVideo';
import { ChatStickerGraphic } from './chatStickersAndEmojis';
import { Check, CheckCheck, Loader2, ShieldCheck, Sparkles } from 'lucide-react';

export function getMessageTime(
  m: Pick<Message, 'id' | 'createdAt' | 'createdAtMs' | 'timestamp'>
): number {
  if (typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) && m.createdAt > 0) {
    return m.createdAt;
  }
  const maybeCreatedAt = m.createdAt as unknown as { toMillis?: () => number } | undefined;
  if (maybeCreatedAt && typeof maybeCreatedAt.toMillis === 'function') {
    const ms = maybeCreatedAt.toMillis();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (typeof m.createdAtMs === 'number' && Number.isFinite(m.createdAtMs) && m.createdAtMs > 0) {
    return m.createdAtMs;
  }
  if (typeof m.createdAt === 'string') {
    const trimmed = m.createdAt.trim();
    if (/^\d{10,}$/.test(trimmed)) {
      const parsedNum = Number(trimmed);
      if (Number.isFinite(parsedNum) && parsedNum > 0) return parsedNum;
    }
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate) && parsedDate > 0) return parsedDate;
  }
  if (typeof m.timestamp === 'string') {
    const parsedTs = Date.parse(m.timestamp);
    if (!Number.isNaN(parsedTs) && parsedTs > 0) return parsedTs;
  }
  const idMatch = String(m.id || '').match(/(\d{12,15})/);
  if (idMatch) {
    const parsedIdMs = Number(idMatch[1]);
    if (Number.isFinite(parsedIdMs) && parsedIdMs > 0) return parsedIdMs;
  }
  return 0;
}

export function formatMessageTime(
  msg: Pick<Message, 'id' | 'createdAt' | 'createdAtMs' | 'createdAtLabel' | 'timestamp'>
): string {
  if (msg.createdAtLabel && msg.createdAtLabel.trim()) {
    return msg.createdAtLabel;
  }
  if (
    typeof msg.createdAt === 'string' &&
    msg.createdAt.trim() &&
    !/^\d{10,}$/.test(msg.createdAt.trim())
  ) {
    return msg.createdAt;
  }
  const ms = getMessageTime(msg);
  if (ms > 0) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return 'Now';
}

export function sortMessagesChronologically(list: Message[]): Message[] {
  return [...list].sort((a, b) => {
    const aTime = getMessageTime(a);
    const bTime = getMessageTime(b);
    if (aTime !== bTime) return aTime - bTime;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

interface ChatMessageItemProps {
  msg: Message;
  isMe: boolean;
}

const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(({ msg, isMe }) => {
  const isSticker = msg.type === 'sticker' || Boolean(msg.stickerId);

  return (
    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
      {isSticker ? (
        <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
          {!isMe && (
            <p className="text-[10px] font-bold text-blue-500 mb-1 px-1">{msg.senderName}</p>
          )}
          <ChatStickerGraphic
            stickerId={msg.stickerId}
            stickerData={msg.stickerData}
            size={110}
          />
        </div>
      ) : (
        <div
          className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 text-xs leading-relaxed break-words ${
            isMe
              ? 'bg-blue-600 text-white rounded-tr-sm shadow-sm'
              : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm'
          }`}
        >
          {!isMe && (
            <p className="text-[10px] font-bold text-blue-500 mb-0.5">{msg.senderName}</p>
          )}

          {msg.mediaUrl && (
            <div className="mb-2 rounded-xl overflow-hidden w-full">
              {msg.mediaType === 'video' ? (
                <ResilientVideo
                  src={msg.mediaUrl}
                  controls
                  compactControls
                  className="w-full h-auto max-h-56 object-contain"
                />
              ) : (
                <ResponsiveImage
                  src={msg.mediaUrl}
                  alt="Chat attachment"
                  fit="contain"
                  className="w-full h-auto max-h-56 object-contain mx-auto block"
                  fallbackText="Attachment unavailable"
                />
              )}
            </div>
          )}

          {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        </div>
      )}

      <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
        <span>{formatMessageTime(msg)}</span>
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
});

ChatMessageItem.displayName = 'ChatMessageItem';

interface ChatMessageListProps {
  messages: Message[];
  currentUserId: string;
  activeConvId: string;
  activeConvName: string;
  isAiThread: boolean;
  aiThinking: boolean;
  onPromptChipClick: (prompt: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const AI_QUICK_PROMPTS = [
  'Explain DBMS 1NF, 2NF, 3NF',
  'BFS vs DFS in DSA',
  'Debug React useEffect loop',
  'Make a 5-day exam study plan',
];

export const ChatMessageList: React.FC<ChatMessageListProps> = React.memo(
  ({
    messages,
    currentUserId,
    activeConvName,
    isAiThread,
    aiThinking,
    onPromptChipClick,
    messagesEndRef,
  }) => {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 no-scrollbar">
        <div className="flex justify-center my-2">
          <span className="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-3 py-1 rounded-full flex items-center gap-1.5 border border-slate-200 dark:border-slate-700">
            {isAiThread ? (
              <>
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span>JIT AI · Ask Studies, Coding, Exams &amp; Campus Questions</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Firebase Cloud Sync · Private Direct &amp; Group Messages</span>
              </>
            )}
          </span>
        </div>

        {isAiThread && (
          <div className="flex flex-wrap gap-1.5 justify-center pb-2">
            {AI_QUICK_PROMPTS.map((promptChip) => (
              <button
                key={promptChip}
                type="button"
                disabled={aiThinking}
                onClick={() => onPromptChipClick(promptChip)}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-indigo-200/80 dark:border-slate-700 hover:border-indigo-500 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 transition-colors"
              >
                {promptChip}
              </button>
            ))}
          </div>
        )}

        {messages.length === 0 ? (
          <p className="text-center text-xs text-slate-400 py-8">
            Say hello to {activeConvName}! Messages sync instantaneously.
          </p>
        ) : (
          messages.map((msg) => (
            <ChatMessageItem
              key={msg.id}
              msg={msg}
              isMe={msg.senderId === currentUserId}
            />
          ))
        )}

        {aiThinking && isAiThread && (
          <div className="flex items-start">
            <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-slate-700 text-xs text-indigo-600 dark:text-indigo-300 flex items-center gap-2 shadow-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>JIT AI is thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    );
  }
);

ChatMessageList.displayName = 'ChatMessageList';
