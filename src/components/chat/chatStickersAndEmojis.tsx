/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Delete, X } from 'lucide-react';

export interface EmojiCategory {
  id: 'smileys' | 'gestures' | 'hearts' | 'gaming' | 'study';
  label: string;
  icon: string;
  emojis: string[];
}

// Strictly widely supported standard Unicode emojis (no broken boxes on Windows Chrome)
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '😉', '😊', '😇', '😍', '🤩', '😘', '😋',
      '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '🤔',
      '😏', '😒', '😔', '😴', '🤯', '😤', '😭', '😱',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👍',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👏', '🙌', '🤝', '🙏', '💪', '👋', '🤚', '✋',
      '👆', '👇', '👈', '👉', '☝️', '✊', '👊', '✍️',
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '💖', '💗', '💓', '💞', '💕', '💘', '💝', '💔',
      '✨', '🌟', '💫', '⭐', '🌸', '🌹', '💐', '☀️',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icon: '🎮',
    emojis: [
      '🎮', '🎲', '♟️', '🎯', '🏆', '🥇', '🥈', '🥉',
      '🏅', '🔥', '⚡', '💥', '🚀', '👑', '💎', '⚔️',
      '🛡️', '🃏', '🎰', '🏁', '📣', '🎉', '🎊', '🎳',
    ],
  },
  {
    id: 'study',
    label: 'Study',
    icon: '📚',
    emojis: [
      '📚', '📖', '📝', '✏️', '🎓', '🏫', '💻', '🖥️',
      '⌨️', '🧠', '💡', '🔬', '🔭', '🧪', '📐', '📏',
      '📊', '📈', '🗂️', '⏰', '☕', '✅', '💯', '🌙',
    ],
  },
];

export interface ChatStickerDef {
  id: string;
  label: string;
  badge: string;
  emoji: string;
  gradientClass: string;
  borderClass: string;
}

// 16 clean, crisp, vibrant sticker cards in a 4-column grid
export const CHAT_STICKERS: ChatStickerDef[] = [
  {
    id: 'stk_hi',
    label: 'Hello',
    badge: 'Hello 👋',
    emoji: '👋',
    gradientClass: 'from-blue-600 to-cyan-500',
    borderClass: 'border-cyan-300/60',
  },
  {
    id: 'stk_gg',
    label: 'GG',
    badge: 'GG 🎮',
    emoji: '🎮',
    gradientClass: 'from-violet-600 to-indigo-600',
    borderClass: 'border-violet-300/60',
  },
  {
    id: 'stk_fire',
    label: 'Fire',
    badge: 'Fire 🔥',
    emoji: '🔥',
    gradientClass: 'from-orange-600 to-red-600',
    borderClass: 'border-amber-300/60',
  },
  {
    id: 'stk_lol',
    label: 'LOL',
    badge: 'LOL 😂',
    emoji: '😂',
    gradientClass: 'from-amber-500 to-orange-600',
    borderClass: 'border-yellow-200/70',
  },
  {
    id: 'stk_love',
    label: 'Love',
    badge: 'Love ❤️',
    emoji: '❤️',
    gradientClass: 'from-rose-600 to-pink-500',
    borderClass: 'border-pink-200/70',
  },
  {
    id: 'stk_thanks',
    label: 'Thanks',
    badge: 'Thanks 🙏',
    emoji: '🙏',
    gradientClass: 'from-sky-600 to-teal-500',
    borderClass: 'border-sky-200/60',
  },
  {
    id: 'stk_study',
    label: 'Study',
    badge: 'Study 📚',
    emoji: '📚',
    gradientClass: 'from-blue-700 to-indigo-500',
    borderClass: 'border-blue-300/60',
  },
  {
    id: 'stk_victory',
    label: 'Winner',
    badge: 'Winner 🏆',
    emoji: '🏆',
    gradientClass: 'from-amber-600 to-yellow-500',
    borderClass: 'border-yellow-200/70',
  },
  {
    id: 'stk_cool',
    label: 'Cool',
    badge: 'Cool 😎',
    emoji: '😎',
    gradientClass: 'from-cyan-600 to-blue-600',
    borderClass: 'border-cyan-200/60',
  },
  {
    id: 'stk_clap',
    label: 'Clap',
    badge: 'Clap 👏',
    emoji: '👏',
    gradientClass: 'from-emerald-600 to-green-500',
    borderClass: 'border-emerald-200/60',
  },
  {
    id: 'stk_thinking',
    label: 'Thinking',
    badge: 'Thinking 🤔',
    emoji: '🤔',
    gradientClass: 'from-purple-600 to-fuchsia-600',
    borderClass: 'border-purple-200/60',
  },
  {
    id: 'stk_party',
    label: 'Party',
    badge: 'Party 🎉',
    emoji: '🎉',
    gradientClass: 'from-pink-600 to-purple-600',
    borderClass: 'border-pink-200/60',
  },
  {
    id: 'stk_100',
    label: '100%',
    badge: '100% 💯',
    emoji: '💯',
    gradientClass: 'from-red-600 to-orange-500',
    borderClass: 'border-orange-200/70',
  },
  {
    id: 'stk_yes',
    label: 'Yes',
    badge: 'Yes ✅',
    emoji: '✅',
    gradientClass: 'from-green-600 to-emerald-500',
    borderClass: 'border-emerald-200/70',
  },
  {
    id: 'stk_night',
    label: 'Good Night',
    badge: 'Good Night 🌙',
    emoji: '🌙',
    gradientClass: 'from-slate-800 to-indigo-800',
    borderClass: 'border-indigo-300/60',
  },
  {
    id: 'stk_star',
    label: 'Star',
    badge: 'Star ⭐',
    emoji: '⭐',
    gradientClass: 'from-indigo-600 to-pink-500',
    borderClass: 'border-yellow-200/70',
  },
];

const LEGACY_STICKER_ALIAS: Record<string, string> = {
  stk_thumbs: 'stk_yes',
  stk_clutch: 'stk_gg',
  stk_brain: 'stk_thinking',
  stk_code: 'stk_study',
  stk_rocket: 'stk_fire',
  stk_coffee: 'stk_study',
  stk_crown: 'stk_victory',
  stk_peace: 'stk_cool',
  stk_exam: 'stk_100',
  stk_mindblown: 'stk_party',
  stk_hearteyes: 'stk_love',
  stk_highfive: 'stk_clap',
};

const STICKER_MAP = new Map<string, ChatStickerDef>(CHAT_STICKERS.map((s) => [s.id, s]));

export function findStickerById(stickerId?: string, stickerData?: string): ChatStickerDef | undefined {
  const tryLookup = (raw?: string): ChatStickerDef | undefined => {
    if (!raw) return undefined;
    if (STICKER_MAP.has(raw)) return STICKER_MAP.get(raw);
    const alias = LEGACY_STICKER_ALIAS[raw];
    if (alias && STICKER_MAP.has(alias)) return STICKER_MAP.get(alias);
    return undefined;
  };
  return tryLookup(stickerId) || tryLookup(stickerData);
}

interface ChatStickerGraphicProps {
  stickerId?: string;
  stickerData?: string;
  variant?: 'message' | 'picker';
}

export const ChatStickerGraphic: React.FC<ChatStickerGraphicProps> = React.memo(
  ({ stickerId, stickerData, variant = 'message' }) => {
    const sticker = findStickerById(stickerId, stickerData) || CHAT_STICKERS[0];

    if (variant === 'picker') {
      return (
        <div className="w-full flex flex-col items-center justify-center gap-1.5 select-none">
          <div
            className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${sticker.gradientClass} border ${sticker.borderClass} flex items-center justify-center shadow-md`}
          >
            <span className="text-[44px] leading-none" role="img" aria-label={sticker.label}>
              {sticker.emoji}
            </span>
          </div>
          <span className="w-full text-center px-1.5 py-0.5 rounded-full bg-slate-950/90 text-[10px] font-bold text-slate-100 leading-tight truncate">
            {sticker.badge}
          </span>
        </div>
      );
    }

    // Chat message variant: clean 96x96px sticker with proper outer padding so edges never clip
    return (
      <div
        className="w-24 h-24 p-1 inline-flex items-center justify-center select-none shrink-0"
        title={sticker.badge}
      >
        <div
          className={`w-full h-full rounded-2xl bg-gradient-to-br ${sticker.gradientClass} border-2 ${sticker.borderClass} shadow-lg flex flex-col items-center justify-between px-1.5 py-1.5`}
        >
          <span className="text-[44px] leading-none mt-0.5" role="img" aria-label={sticker.label}>
            {sticker.emoji}
          </span>
          <span className="w-full text-center px-1.5 py-0.5 rounded-full bg-slate-950/85 text-[10px] font-extrabold text-white leading-tight truncate">
            {sticker.badge}
          </span>
        </div>
      </div>
    );
  }
);

ChatStickerGraphic.displayName = 'ChatStickerGraphic';

interface EmojiStickerPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onBackspace: () => void;
  onClearText: () => void;
  onSelectSticker: (sticker: ChatStickerDef) => void;
  onClose: () => void;
}

export const EmojiStickerPicker: React.FC<EmojiStickerPickerProps> = React.memo(
  ({ onSelectEmoji, onBackspace, onClearText, onSelectSticker, onClose }) => {
    const [activeTab, setActiveTab] = useState<'emojis' | 'stickers'>('emojis');
    const [activeCategory, setActiveCategory] = useState<EmojiCategory['id']>('smileys');

    const currentEmojiCategory =
      EMOJI_CATEGORIES.find((cat) => cat.id === activeCategory) || EMOJI_CATEGORIES[0];

    return (
      <div
        className="absolute bottom-full left-2 sm:left-3 mb-2 z-40 w-[332px] sm:w-[372px] max-w-[calc(100vw-1.5rem)] bg-slate-900 text-white border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-label="Emoji and Sticker Picker"
      >
        {/* Top Tabs: Emojis / Stickers + Close */}
        <div className="flex items-center justify-between px-2.5 pt-2 pb-1.5 border-b border-slate-800 bg-slate-950/80">
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
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Close picker"
            aria-label="Close picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeTab === 'emojis' ? (
          <div>
            {/* 5 compact category pills in a single row (no overflow or cut-off labels) */}
            <div className="grid grid-cols-5 gap-1 px-2 py-1.5 border-b border-slate-800 bg-slate-900">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-1 py-1 rounded-lg text-[10px] font-bold flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-slate-800 text-blue-400 border border-blue-500/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <span className="text-xs leading-none">{cat.icon}</span>
                  <span className="leading-none truncate max-w-full">{cat.label}</span>
                </button>
              ))}
            </div>

            {/* 8-column Emoji Grid */}
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

            {/* Footer with Backspace & Clear controls */}
            <div className="px-2.5 py-1.5 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400 truncate">
                Tap an emoji to insert
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={onBackspace}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold flex items-center gap-1 transition-colors"
                  title="Backspace"
                >
                  <Delete className="w-3 h-3" />
                  <span>Backspace</span>
                </button>
                <button
                  type="button"
                  onClick={onClearText}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-300 hover:text-red-300 text-[10px] font-bold transition-colors"
                  title="Clear input"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2.5 h-64 overflow-y-auto grid grid-cols-4 gap-2.5 no-scrollbar">
            {CHAT_STICKERS.map((stk) => (
              <button
                key={stk.id}
                type="button"
                onClick={() => onSelectSticker(stk)}
                className="flex flex-col items-center justify-center p-1.5 rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-transparent hover:border-indigo-500/60 transition-all active:scale-95"
                title={`Send ${stk.badge} sticker`}
              >
                <ChatStickerGraphic stickerId={stk.id} variant="picker" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);

EmojiStickerPicker.displayName = 'EmojiStickerPicker';
