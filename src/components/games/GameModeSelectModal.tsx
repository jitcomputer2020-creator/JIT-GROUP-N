/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GameId } from '../../types';
import { GameMode, AIDifficulty } from '../../types/multiplayer';
import { APP_CONFIG } from '../../constants/branding';
import { GameLogo } from './GameLogo';
import {
  Users,
  UserPlus,
  Bot,
  Shuffle,
  KeyRound,
  X,
  Play,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  Check,
  AlertCircle,
} from 'lucide-react';

interface GameModeSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: GameId;
  onCreateFriendRoom: () => void;
  onJoinFriendRoom: (code: string) => void;
  onPlayRandom: () => void;
  onPlayAI: (difficulty: AIDifficulty) => void;
  joinError?: string | null;
}

export const GameModeSelectModal: React.FC<GameModeSelectModalProps> = ({
  isOpen,
  onClose,
  gameId,
  onCreateFriendRoom,
  onJoinFriendRoom,
  onPlayRandom,
  onPlayAI,
  joinError,
}) => {
  const [selectedTab, setSelectedTab] = useState<GameMode>('friend');
  const [friendAction, setFriendAction] = useState<'create' | 'join'>('create');
  const [enteredCode, setEnteredCode] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<AIDifficulty>('medium');
  const [codeValidationError, setCodeValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const gameInfo = APP_CONFIG.games.find((g) => g.id === gameId);
  const gameName = gameInfo?.name || 'Game';

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = enteredCode.replace(/\D/g, '').trim();
    if (clean.length !== 4) {
      setCodeValidationError('Please enter a valid 4-digit numeric room code.');
      return;
    }
    setCodeValidationError(null);
    onJoinFriendRoom(clean);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <GameLogo gameId={gameId} size="md" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-lg">
                  JIT Gaming Arena
                </span>
                <span className="text-xs text-slate-400">· {gameInfo?.category}</span>
              </div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                Play {gameName}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Error Banner if join fails */}
        {(joinError || codeValidationError) && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-2xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{joinError || codeValidationError}</span>
          </div>
        )}

        {/* 3 Main Mode Selection Tabs */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-2xl">
          <button
            type="button"
            onClick={() => setSelectedTab('friend')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col sm:flex-row items-center justify-center gap-1.5 ${
              selectedTab === 'friend'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>With Friend</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('random')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col sm:flex-row items-center justify-center gap-1.5 ${
              selectedTab === 'random'
                ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Shuffle className="w-4 h-4" />
            <span>Random Match</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('ai')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col sm:flex-row items-center justify-center gap-1.5 ${
              selectedTab === 'ai'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>AI Bot</span>
          </button>
        </div>

        {/* TAB 1: PLAY WITH FRIEND */}
        {selectedTab === 'friend' && (
          <div className="space-y-4 pt-1 animate-in fade-in">
            <div className="flex rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-1 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setFriendAction('create')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                  friendAction === 'create'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Create 4-Digit Room
              </button>
              <button
                type="button"
                onClick={() => setFriendAction('join')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                  friendAction === 'join'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Join Friend's Room
              </button>
            </div>

            {friendAction === 'create' ? (
              <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/20 border border-blue-100 dark:border-blue-900/40 rounded-3xl space-y-3">
                <div className="flex items-center gap-2.5 text-blue-700 dark:text-blue-300 font-bold text-sm">
                  <KeyRound className="w-4 h-4" />
                  <span>Host a Private 4-Digit Room</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Generate a unique 4-digit code (e.g. <strong>4829</strong>) for {gameName}. Share the code with your campus friends to start real-time play with live chat and calling!
                </p>
                <button
                  type="button"
                  onClick={onCreateFriendRoom}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Create Room & Get 4-Digit Code</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleJoinSubmit} className="p-5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-3xl space-y-3">
                <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold text-sm">
                  <KeyRound className="w-4 h-4 text-blue-600" />
                  <span>Enter 4-Digit Room Code</span>
                </div>
                <p className="text-xs text-slate-500">
                  Ask your friend for their 4-digit {gameName} invite code.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    placeholder="e.g. 5291"
                    value={enteredCode}
                    onChange={(e) => {
                      setEnteredCode(e.target.value.replace(/\D/g, ''));
                      setCodeValidationError(null);
                    }}
                    className="flex-1 px-4 py-2.5 text-center text-lg font-mono font-black tracking-widest bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={enteredCode.length !== 4}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 text-white font-bold text-xs rounded-2xl shadow-md transition-all shrink-0"
                  >
                    Join Room
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* TAB 2: PLAY WITH RANDOM PLAYER */}
        {selectedTab === 'random' && (
          <div className="p-5 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/30 dark:to-pink-950/20 border border-purple-100 dark:border-purple-900/40 rounded-3xl space-y-3 animate-in fade-in">
            <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300 font-bold text-sm">
              <Shuffle className="w-4 h-4" />
              <span>Campus Quick Matchmaking</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Match instantly with any online JIT campus peer waiting to play {gameName}. If no opponent is immediately available, you will host a public queue until an opponent joins.
            </p>
            <button
              type="button"
              onClick={onPlayRandom}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2 transition-all"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Find Opponent & Match</span>
            </button>
          </div>
        )}

        {/* TAB 3: PLAY WITH AI BOT */}
        {selectedTab === 'ai' && (
          <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-3xl space-y-4 animate-in fade-in">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
              <Bot className="w-4 h-4" />
              <span>Play Against Campus AI Bot</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Sharpen your skills against an AI opponent making authentic legal moves according to official {gameName} rules. Choose your challenge level:
            </p>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'easy', label: 'Easy', desc: 'Casual moves' },
                  { id: 'medium', label: 'Medium', desc: 'Balanced tactics' },
                  { id: 'hard', label: 'Hard', desc: 'Master strategy' },
                ] as const
              ).map((lvl) => {
                const isSelected = selectedDifficulty === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setSelectedDifficulty(lvl.id)}
                    className={`p-3 rounded-2xl border text-center transition-all ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-400'
                    }`}
                  >
                    <p className="text-xs font-bold">{lvl.label}</p>
                    <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-emerald-100' : 'text-slate-400'}`}>
                      {lvl.desc}
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => onPlayAI(selectedDifficulty)}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Start vs {selectedDifficulty.toUpperCase()} AI</span>
            </button>
          </div>
        )}

        <div className="text-[11px] text-slate-400 text-center leading-relaxed">
          All games run with server-authoritative state synchronization, live in-game chat, and voice/video calling support.
        </div>
      </div>
    </div>
  );
};
