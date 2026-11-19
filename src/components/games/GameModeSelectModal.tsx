/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GameId } from '../../types';
import { GameMode, AIDifficulty, MultiplayerRoom } from '../../types/multiplayer';
import { APP_CONFIG } from '../../constants/branding';
import { listPublicOpenGroupRooms } from '../../lib/firebase';
import { GameLogo } from './GameLogo';
import {
  Users,
  Bot,
  Shuffle,
  KeyRound,
  X,
  Play,
  Sparkles,
  AlertCircle,
  Loader2,
  Flame,
  RefreshCw,
} from 'lucide-react';

interface GameModeSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: GameId;
  onCreateFriendRoom: () => void;
  onJoinFriendRoom: (code: string) => void;
  onPlayRandom: () => void;
  onCreateOpenGroupRoom: (activeSeatLimit: number) => void;
  onPlayAI: (difficulty: AIDifficulty) => void;
  joinError?: string | null;
  isSubmitting?: boolean;
}

export const GameModeSelectModal: React.FC<GameModeSelectModalProps> = ({
  isOpen,
  onClose,
  gameId,
  onCreateFriendRoom,
  onJoinFriendRoom,
  onPlayRandom,
  onCreateOpenGroupRoom,
  onPlayAI,
  joinError,
  isSubmitting = false,
}) => {
  const [selectedTab, setSelectedTab] = useState<GameMode>('friend');
  const [friendAction, setFriendAction] = useState<'create' | 'join'>('create');
  const [enteredCode, setEnteredCode] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<AIDifficulty>('medium');
  const [seatLimit, setSeatLimit] = useState<number>(6);
  const [openRooms, setOpenRooms] = useState<MultiplayerRoom[]>([]);
  const [loadingOpenRooms, setLoadingOpenRooms] = useState(false);
  const [codeValidationError, setCodeValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (gameId === 'truth_dare') {
      setSelectedTab('open_group');
      setSeatLimit(6);
    } else if (gameId === 'ludo') {
      setSeatLimit(4);
    } else {
      setSeatLimit(2);
    }
  }, [isOpen, gameId]);

  const loadOpenRooms = async () => {
    setLoadingOpenRooms(true);
    try {
      const list = await listPublicOpenGroupRooms(gameId);
      setOpenRooms(list);
    } finally {
      setLoadingOpenRooms(false);
    }
  };

  useEffect(() => {
    if (isOpen && selectedTab === 'open_group') {
      loadOpenRooms();
    }
  }, [isOpen, selectedTab, gameId]);

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
            type="button"
            onClick={onClose}
            aria-label="Close Mode Selection"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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

        {/* 4 Main Mode Selection Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-2xl">
          <button
            type="button"
            onClick={() => setSelectedTab('friend')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
              selectedTab === 'friend'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>With Friend</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('random')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
              selectedTab === 'random'
                ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Random</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('open_group')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
              selectedTab === 'open_group'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Open Group</span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedTab('ai')}
            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap ${
              selectedTab === 'ai'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>
              {gameId === 'truth_dare'
                ? 'Party Solo'
                : gameId === 'spin_wheel'
                ? 'Solo Bonus'
                : 'AI Bot'}
            </span>
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
                Join Friend&apos;s Room
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
                  disabled={isSubmitting}
                  onClick={onCreateFriendRoom}
                  className="w-full py-3 min-h-[44px] bg-blue-600 hover:bg-blue-700 disabled:opacity-60 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>{isSubmitting ? 'Creating 4-Digit Room...' : 'Create Room & Get 4-Digit Code'}</span>
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
                    disabled={enteredCode.length !== 4 || isSubmitting}
                    className="px-5 py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 text-white font-bold text-xs rounded-2xl shadow-md transition-all shrink-0 flex items-center gap-1.5"
                  >
                    {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isSubmitting ? 'Joining...' : 'Join Room'}</span>
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
              Enter the live queue with a countdown timer to match automatically with an online JIT player looking to play {gameName}.
            </p>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onPlayRandom}
              className="w-full py-3 min-h-[44px] bg-purple-600 hover:bg-purple-700 disabled:opacity-60 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2 transition-all"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
              <span>{isSubmitting ? 'Entering Queue...' : 'Find Opponent & Match'}</span>
            </button>
          </div>
        )}

        {/* TAB 3: OPEN GROUP GAME (UNLIMITED JOINERS + WAITING SEAT QUEUE) */}
        {selectedTab === 'open_group' && (
          <div className="space-y-4 pt-1 animate-in fade-in">
            <div className="p-5 bg-gradient-to-br from-rose-50 to-amber-50/50 dark:from-rose-950/30 dark:to-amber-950/20 border border-rose-100 dark:border-rose-900/40 rounded-3xl space-y-3">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-sm">
                <Flame className="w-4 h-4" />
                <span>Open Group Lobby (Unlimited Joining)</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Host an open room where unlimited campus peers can join! Extra players sit in the live Waiting Seat queue, talk in Voice & Chat, send reactions, and rotate in after matches.
              </p>

              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  Active Playing Seats:
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[2, 4, 6, 8].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSeatLimit(n)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-colors ${
                        seatLimit === n
                          ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {n} Seats
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onCreateOpenGroupRoom(seatLimit)}
                className="w-full py-3 min-h-[44px] bg-rose-600 hover:bg-rose-700 disabled:opacity-60 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 transition-all"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                <span>
                  {isSubmitting ? 'Launching Open Group...' : `Host Open ${gameName} Room`}
                </span>
              </button>
            </div>

            {/* Join by code OR live Open Group browser */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Live Open Group Rooms Online
                </span>
                <button
                  type="button"
                  onClick={loadOpenRooms}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 hover:underline"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingOpenRooms ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {loadingOpenRooms ? (
                <div className="py-4 flex items-center justify-center text-xs text-slate-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading open rooms...</span>
                </div>
              ) : openRooms.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                  No open {gameName} groups active right now — host the first one above or enter a 4-digit code below!
                </p>
              ) : (
                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {openRooms.map((r) => {
                    const total = r.players.length + (r.waitingPlayers?.length || 0);
                    return (
                      <div
                        key={r.roomCode}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            Room #{r.roomCode} · Host: {r.players.find((p) => p.isHost)?.name || 'Peer'}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {total} Online ({r.players.length} Active / {r.waitingPlayers?.length || 0} Waiting)
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => onJoinFriendRoom(r.roomCode)}
                          className="px-3 py-1.5 min-h-[34px] bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shrink-0"
                        >
                          Join Group
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <form onSubmit={handleJoinSubmit} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  maxLength={4}
                  inputMode="numeric"
                  placeholder="4-digit code"
                  value={enteredCode}
                  onChange={(e) => {
                    setEnteredCode(e.target.value.replace(/\D/g, ''));
                    setCodeValidationError(null);
                  }}
                  className="flex-1 px-3 py-2 text-center text-sm font-mono font-bold tracking-widest bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={enteredCode.length !== 4 || isSubmitting}
                  className="px-4 py-2 min-h-[38px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold disabled:opacity-40"
                >
                  Join Code
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: PLAY WITH AI BOT OR PARTY SOLO */}
        {selectedTab === 'ai' && (
          <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-3xl space-y-4 animate-in fade-in">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
              <Bot className="w-4 h-4" />
              <span>
                {gameId === 'truth_dare'
                  ? 'Local Party / Solo Deck'
                  : gameId === 'spin_wheel'
                  ? 'Daily Solo Bonus Wheel'
                  : 'Play Against Campus AI Bot'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {gameId === 'truth_dare'
                ? 'Launch an instant Truth & Dare session right here on this screen with System Choice & Own Choice prompts.'
                : gameId === 'spin_wheel'
                ? 'Spin the wheel solo to win daily JIT Points, or choose With Friend / Random / Open Group above to spin live with peers!'
                : `Sharpen your skills against an AI opponent making authentic legal moves according to official ${gameName} rules. Choose your challenge level:`}
            </p>

            {gameId !== 'truth_dare' && gameId !== 'spin_wheel' && (
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
            )}

            <button
              type="button"
              onClick={() => onPlayAI(selectedDifficulty)}
              className="w-full py-3 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-xs rounded-2xl shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>
                {gameId === 'truth_dare'
                  ? 'Start Party Truth & Dare'
                  : gameId === 'spin_wheel'
                  ? 'Start Solo Lucky Spin'
                  : `Start vs ${selectedDifficulty.toUpperCase()} AI`}
              </span>
            </button>
          </div>
        )}

        <div className="text-[11px] text-slate-400 text-center leading-relaxed">
          All games run with real-time state synchronization, live emoji reactions, chat, and WebRTC voice support.
        </div>
      </div>
    </div>
  );
};
