/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Message } from '../../types';
import { ResponsiveImage } from '../common/ResponsiveImage';
import { ResilientVideo } from '../common/ResilientVideo';
import { ChatStickerGraphic } from './chatStickersAndEmojis';
import { Check, CheckCheck, Gamepad2, Loader2, ShieldCheck, Sparkles } from 'lucide-react';

import {
  normalizeTimestamp,
  resolveServerTimeLabel,
  sortMessagesChronologically,
} from '../../lib/chatTimestamp';

export { normalizeTimestamp, resolveServerTimeLabel, sortMessagesChronologically };
export const getMessageTime = normalizeTimestamp;

export function formatMessageTime(
  msg: Pick<
    Message,
    'id' | 'createdAt' | 'createdAtMs' | 'clientCreatedAt' | 'createdAtLabel' | 'timestamp' | 'time' | 'date'
  >
): string {
  return resolveServerTimeLabel(msg);
}

interface ChatMessageItemProps {
  msg: Message;
  isMe: boolean;
  currentUserId: string;
  onJoinGameRoom?: (roomId: string, gameId?: string) => void;
}

const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(
  ({ msg, isMe, currentUserId, onJoinGameRoom }) => {
    const isSticker = msg.type === 'sticker' || Boolean(msg.stickerId);
    const isGameInvite = Boolean(msg.gameInvite?.roomId);
    const isRead =
      msg.status === 'read' ||
      (Array.isArray(msg.readBy) && msg.readBy.some((uid) => uid && uid !== currentUserId));

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
              variant="message"
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

            {isGameInvite && msg.gameInvite && (
              <div
                className={`mt-2 p-2.5 rounded-xl border flex flex-col gap-2 ${
                  isMe
                    ? 'bg-blue-700/60 border-blue-400/40 text-white'
                    : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-slate-900 dark:text-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                  <span className="flex items-center gap-1.5">
                    <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{msg.gameInvite.gameName}</span>
                  </span>
                  <span className="font-mono opacity-85">#{msg.gameInvite.roomId}</span>
                </div>
                {onJoinGameRoom && (
                  <button
                    type="button"
                    onClick={() => onJoinGameRoom(msg.gameInvite!.roomId, msg.gameInvite!.gameId)}
                    className={`w-full py-1.5 px-3 rounded-lg text-[11px] font-bold transition-colors ${
                      isMe
                        ? 'bg-white text-blue-700 hover:bg-blue-50'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    Join Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1">
          <span>{formatMessageTime(msg)}</span>
          {isMe && (
            <span
              className="inline-flex items-center"
              title={isRead ? 'Read' : 'Sent'}
              aria-label={isRead ? 'Read' : 'Sent'}
            >
              {isRead ? (
                <CheckCheck className="w-3.5 h-3.5 text-sky-400 inline" />
              ) : (
                <Check className="w-3.5 h-3.5 text-slate-400 dark:text-slate-300/80 inline" />
              )}
            </span>
          )}
        </div>
      </div>
    );
  }
);

ChatMessageItem.displayName = 'ChatMessageItem';

interface ChatMessageListProps {
  messages: Message[];
  currentUserId: string;
  activeConvId: string;
  activeConvName: string;
  isAiThread: boolean;
  aiThinking: boolean;
  typingNames?: string[];
  onPromptChipClick: (prompt: string) => void;
  onJoinGameRoom?: (roomId: string, gameId?: string) => void;
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
    typingNames = [],
    onPromptChipClick,
    onJoinGameRoom,
    messagesEndRef,
  }) => {
    return (
      <div className="flex-1 min-h-0 w-full min-w-0 box-border overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-3 no-scrollbar">
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
              currentUserId={currentUserId}
              onJoinGameRoom={onJoinGameRoom}
            />
          ))
        )}

        {typingNames.length > 0 && !isAiThread && (
          <div className="flex items-start">
            <div className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-emerald-500/40 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2 shadow-sm">
              <span className="font-semibold">
                {typingNames.length === 1 ? `${typingNames[0]} is typing` : 'typing'}
              </span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 jit-typing-dot" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 jit-typing-dot"
                  style={{ animationDelay: '0.18s' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500 jit-typing-dot"
                  style={{ animationDelay: '0.36s' }}
                />
              </span>
            </div>
          </div>
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
