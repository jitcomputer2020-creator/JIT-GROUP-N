/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface FloatingReactionItem {
  id: string;
  emoji: string;
  senderName: string;
  leftPct: number;
}

export const QUICK_REACTION_PRESETS: Array<{ emoji: string; label: string }> = [
  { emoji: '👍', label: 'Thumbs Up' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '🎉', label: 'Celebrate' },
  { emoji: '😱', label: 'Shocked' },
];

interface FloatingReactionsOverlayProps {
  reactions: FloatingReactionItem[];
}

export const FloatingReactionsOverlay: React.FC<FloatingReactionsOverlayProps> = ({ reactions }) => {
  if (reactions.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-x-0 bottom-24 sm:bottom-28 z-50 pointer-events-none h-64 overflow-hidden"
    >
      {reactions.map((rx) => (
        <div
          key={rx.id}
          style={{ left: `${Math.min(86, Math.max(10, rx.leftPct))}%` }}
          className="absolute bottom-2 -translate-x-1/2 flex flex-col items-center animate-jit-float-reaction select-none"
        >
          <span className="text-3xl sm:text-4xl drop-shadow-md leading-none">{rx.emoji}</span>
          <span className="mt-1 px-2 py-0.5 rounded-full bg-slate-900/80 text-white text-[10px] font-bold shadow-sm whitespace-nowrap max-w-[110px] truncate">
            {rx.senderName.split(' ')[0]}
          </span>
        </div>
      ))}
    </div>
  );
};

interface QuickReactionBarProps {
  onSendReaction: (emoji: string) => void;
  disabled?: boolean;
}

export const QuickReactionBar: React.FC<QuickReactionBarProps> = ({
  onSendReaction,
  disabled = false,
}) => {
  return (
    <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        Live Reactions
      </span>
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
        {QUICK_REACTION_PRESETS.map((preset) => (
          <button
            key={preset.emoji}
            type="button"
            disabled={disabled}
            onClick={() => onSendReaction(preset.emoji)}
            aria-label={`Send ${preset.label} reaction`}
            title={`React ${preset.label}`}
            className="min-w-[44px] min-h-[44px] px-2.5 rounded-2xl bg-slate-50 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-lg sm:text-xl flex items-center justify-center transition-transform active:scale-125 hover:scale-110 disabled:opacity-40 touch-manipulate"
          >
            {preset.emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
