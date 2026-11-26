/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

export interface EmojiCategory {
  id: 'smileys' | 'gestures' | 'hearts' | 'gaming' | 'study';
  label: string;
  icon: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘',
      '😋', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
      '😏', '😒', '😔', '😴', '🤯', '😤', '😭', '😱',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👍',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👏', '🙌', '🫶', '🤝', '🙏', '💪', '👋', '🤚',
      '✋', '🖐️', '👆', '👇', '👈', '👉', '☝️', '🫡',
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🩷', '🩵', '💖', '💗', '💓', '💞', '💕', '💘',
      '💝', '❤️‍🔥', '✨', '🌟', '💫', '🌸', '🌹', '💐',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icon: '🎮',
    emojis: [
      '🎮', '🕹️', '🎲', '♟️', '🎯', '🏆', '🥇', '🥈',
      '🥉', '🏅', '🔥', '⚡', '💥', '🚀', '👑', '💎',
      '⚔️', '🛡️', '🃏', '🎰', '🏁', '📣', '🎉', '🎊',
    ],
  },
  {
    id: 'study',
    label: 'Study',
    icon: '📚',
    emojis: [
      '📚', '📖', '📝', '✏️', '🖊️', '🎓', '🏫', '💻',
      '🖥️', '⌨️', '🧠', '💡', '🔬', '🔭', '🧪', '📐',
      '📏', '📊', '📈', '🗂️', '⏰', '☕', '✅', '💯',
    ],
  },
];

export interface ChatStickerDef {
  id: string;
  label: string;
  subtitle: string;
  from: string;
  to: string;
  accent: string;
  glyph: string;
  badgeText: string;
}

export const CHAT_STICKERS: ChatStickerDef[] = [
  { id: 'stk_hi', label: 'Hey There!', subtitle: 'GREETINGS', from: '#2563eb', to: '#06b6d4', accent: '#fde047', glyph: '👋', badgeText: 'HI!' },
  { id: 'stk_gg', label: 'Good Game', subtitle: 'WELL PLAYED', from: '#7c3aed', to: '#4f46e5', accent: '#34d399', glyph: '🎮', badgeText: 'GG!' },
  { id: 'stk_fire', label: 'On Fire', subtitle: 'UNSTOPPABLE', from: '#ea580c', to: '#dc2626', accent: '#fde047', glyph: '🔥', badgeText: 'LIT!' },
  { id: 'stk_lol', label: 'Haha LOL', subtitle: 'SO FUNNY', from: '#f59e0b', to: '#ea580c', accent: '#ffffff', glyph: '😂', badgeText: 'LOL' },
  { id: 'stk_love', label: 'Big Love', subtitle: 'SENDING LOVE', from: '#e11d48', to: '#ec4899', accent: '#fbcfe8', glyph: '💖', badgeText: 'LOVE' },
  { id: 'stk_thumbs', label: 'Approved', subtitle: 'NICE ONE', from: '#059669', to: '#10b981', accent: '#fef08a', glyph: '👍', badgeText: 'NICE!' },
  { id: 'stk_study', label: 'Study Mode', subtitle: 'FOCUS TIME', from: '#1d4ed8', to: '#3b82f6', accent: '#bfdbfe', glyph: '📚', badgeText: 'STUDY' },
  { id: 'stk_victory', label: 'Victory', subtitle: 'CHAMPION', from: '#d97706', to: '#eab308', accent: '#fef9c3', glyph: '🏆', badgeText: 'WIN!' },
  { id: 'stk_clutch', label: 'Clutch Play', subtitle: 'PRO MOVE', from: '#0f766e', to: '#14b8a6', accent: '#99f6e4', glyph: '⚡', badgeText: 'CLUTCH' },
  { id: 'stk_brain', label: 'Big Brain', subtitle: 'GENIUS IDEA', from: '#6d28d9', to: '#a855f7', accent: '#e9d5ff', glyph: '🧠', badgeText: 'SMART' },
  { id: 'stk_code', label: 'Code Ninja', subtitle: 'SHIPPING IT', from: '#1e293b', to: '#334155', accent: '#38bdf8', glyph: '💻', badgeText: '</>' },
  { id: 'stk_cool', label: 'Too Cool', subtitle: 'CHILL VIBES', from: '#0284c7', to: '#2563eb', accent: '#bae6fd', glyph: '😎', badgeText: 'COOL' },
  { id: 'stk_party', label: 'Party Time', subtitle: 'CELEBRATE', from: '#be185d', to: '#9333ea', accent: '#fde047', glyph: '🥳', badgeText: 'YAY!' },
  { id: 'stk_rocket', label: 'To The Moon', subtitle: 'LET’S GO', from: '#4338ca', to: '#0ea5e9', accent: '#fde047', glyph: '🚀', badgeText: 'GO!' },
  { id: 'stk_coffee', label: 'Coffee Break', subtitle: 'RECHARGE', from: '#78350f', to: '#b45309', accent: '#fde68a', glyph: '☕', badgeText: 'CHAI' },
  { id: 'stk_100', label: '100 Percent', subtitle: 'FACTS ONLY', from: '#dc2626', to: '#f97316', accent: '#ffffff', glyph: '💯', badgeText: '100%' },
  { id: 'stk_star', label: 'Superstar', subtitle: 'AMAZING', from: '#4f46e5', to: '#ec4899', accent: '#fef08a', glyph: '🌟', badgeText: 'STAR' },
  { id: 'stk_crown', label: 'Royalty', subtitle: 'TOP RANK', from: '#b45309', to: '#f59e0b', accent: '#fef3c7', glyph: '👑', badgeText: 'KING' },
  { id: 'stk_peace', label: 'Peace Out', subtitle: 'SEE YA SOON', from: '#0d9488', to: '#06b6d4', accent: '#ccfbf1', glyph: '✌️', badgeText: 'PEACE' },
  { id: 'stk_exam', label: 'Exam Ready', subtitle: 'ACE IT', from: '#15803d', to: '#22c55e', accent: '#dcfce7', glyph: '🎓', badgeText: 'A+!' },
  { id: 'stk_mindblown', label: 'Mind Blown', subtitle: 'NO WAY!', from: '#9333ea', to: '#e11d48', accent: '#fde047', glyph: '🤯', badgeText: 'WHOA!' },
  { id: 'stk_hearteyes', label: 'Adore It', subtitle: 'SO GOOD', from: '#db2777', to: '#f43f5e', accent: '#ffe4e6', glyph: '😍', badgeText: 'WOW!' },
  { id: 'stk_highfive', label: 'High Five', subtitle: 'TEAMWORK', from: '#2563eb', to: '#6366f1', accent: '#fef08a', glyph: '🙌', badgeText: 'TEAM' },
  { id: 'stk_thanks', label: 'Thank You', subtitle: 'GRATEFUL', from: '#0369a1', to: '#0d9488', accent: '#e0f2fe', glyph: '🙏', badgeText: 'THX!' },
];

const STICKER_MAP = new Map<string, ChatStickerDef>(CHAT_STICKERS.map((s) => [s.id, s]));

export function findStickerById(stickerId?: string, stickerData?: string): ChatStickerDef | undefined {
  if (stickerId && STICKER_MAP.has(stickerId)) {
    return STICKER_MAP.get(stickerId);
  }
  if (stickerData && STICKER_MAP.has(stickerData)) {
    return STICKER_MAP.get(stickerData);
  }
  return undefined;
}

interface ChatStickerGraphicProps {
  stickerId?: string;
  stickerData?: string;
  size?: number;
}

export const ChatStickerGraphic: React.FC<ChatStickerGraphicProps> = React.memo(
  ({ stickerId, stickerData, size = 110 }) => {
    const sticker = findStickerById(stickerId, stickerData) || CHAT_STICKERS[0];
    const gradId = `stk_g_${sticker.id}`;

    return (
      <div
        className="inline-flex items-center justify-center select-none shrink-0"
        style={{ width: size, height: size }}
        title={sticker.label}
      >
        <svg
          viewBox="0 0 110 110"
          width={size}
          height={size}
          className="drop-shadow-md overflow-visible"
          aria-label={sticker.label}
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={sticker.from} />
              <stop offset="100%" stopColor={sticker.to} />
            </linearGradient>
          </defs>

          {/* Outer crisp white sticker die-cut outline */}
          <rect
            x="6"
            y="8"
            width="98"
            height="94"
            rx="26"
            fill="#ffffff"
            fillOpacity="0.96"
          />
          {/* Inner vibrant gradient badge */}
          <rect
            x="10"
            y="12"
            width="90"
            height="86"
            rx="22"
            fill={`url(#${gradId})`}
          />
          {/* Top gloss highlight */}
          <path
            d="M 18 22 C 32 14, 78 14, 92 22 C 88 30, 22 30, 18 22 Z"
            fill="#ffffff"
            fillOpacity="0.2"
          />
          {/* Decorative corner sparkles */}
          <circle cx="23" cy="24" r="2.2" fill={sticker.accent} fillOpacity="0.9" />
          <circle cx="87" cy="24" r="1.8" fill={sticker.accent} fillOpacity="0.8" />
          <circle cx="88" cy="76" r="2" fill="#ffffff" fillOpacity="0.35" />

          {/* Main expressive glyph */}
          <text
            x="55"
            y="57"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="38"
          >
            {sticker.glyph}
          </text>

          {/* Sticker caption pill at bottom */}
          <rect
            x="18"
            y="77"
            width="74"
            height="17"
            rx="8.5"
            fill="#0f172a"
            fillOpacity="0.88"
          />
          <text
            x="55"
            y="86"
            textAnchor="middle"
            dominantBaseline="central"
            fill={sticker.accent}
            fontSize="10"
            fontWeight="900"
            letterSpacing="0.8"
            fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
          >
            {sticker.badgeText}
          </text>
        </svg>
      </div>
    );
  }
);

ChatStickerGraphic.displayName = 'ChatStickerGraphic';

interface EmojiStickerPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker: (sticker: ChatStickerDef) => void;
  onClose: () => void;
}

export const EmojiStickerPicker: React.FC<EmojiStickerPickerProps> = React.memo(
  ({ onSelectEmoji, onSelectSticker, onClose }) => {
    const [activeTab, setActiveTab] = useState<'emojis' | 'stickers'>('emojis');
    const [activeCategory, setActiveCategory] = useState<EmojiCategory['id']>('smileys');

    const currentEmojiCategory =
      EMOJI_CATEGORIES.find((cat) => cat.id === activeCategory) || EMOJI_CATEGORIES[0];

    return (
      <div
        className="absolute bottom-full left-2 sm:left-3 mb-2 z-40 w-[300px] sm:w-[340px] bg-slate-900 text-white border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-label="Emoji and Sticker Picker"
      >
        {/* Top Tabs: Emojis / Stickers */}
        <div className="flex items-center justify-between px-2.5 pt-2 pb-1.5 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-1 bg-slate-800/90 p-0.5 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('emojis')}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                activeTab === 'emojis'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Emojis
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('stickers')}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                activeTab === 'stickers'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Stickers
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 font-semibold"
          >
            Close
          </button>
        </div>

        {activeTab === 'emojis' ? (
          <div>
            {/* Category Bar */}
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-800 bg-slate-900 overflow-x-auto no-scrollbar">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap flex items-center gap-1 transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-slate-800 text-blue-400 border border-blue-500/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>

            {/* Emoji Grid */}
            <div className="p-2.5 h-52 overflow-y-auto grid grid-cols-8 gap-1 no-scrollbar">
              {currentEmojiCategory.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSelectEmoji(emoji)}
                  className="h-8 flex items-center justify-center text-lg rounded-lg hover:bg-slate-800 active:scale-95 transition-transform"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-2.5 h-60 overflow-y-auto grid grid-cols-4 gap-2 no-scrollbar">
            {CHAT_STICKERS.map((stk) => (
              <button
                key={stk.id}
                type="button"
                onClick={() => onSelectSticker(stk)}
                className="flex flex-col items-center justify-center p-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-transparent hover:border-indigo-500/50 transition-all active:scale-95"
                title={`Send ${stk.label} sticker`}
              >
                <ChatStickerGraphic stickerId={stk.id} size={58} />
                <span className="text-[9px] font-semibold text-slate-300 truncate max-w-full mt-1">
                  {stk.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);

EmojiStickerPicker.displayName = 'EmojiStickerPicker';
