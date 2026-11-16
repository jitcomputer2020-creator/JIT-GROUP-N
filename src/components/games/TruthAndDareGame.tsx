/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  RoomPlayer,
  TruthAndDareState,
  TruthAndDareHistoryItem,
} from '../../types/multiplayer';
import { APP_CONFIG } from '../../constants/branding';
import {
  Sparkles,
  Flame,
  MessageCircleHeart,
  Shuffle,
  Edit3,
  CheckCircle2,
  SkipForward,
  Users,
  RotateCw,
  ArrowRightLeft,
} from 'lucide-react';

const TRUTH_PROMPTS: string[] = [
  'What is the funniest excuse you have ever given a professor for being late?',
  'Who in this room would survive the longest in a zombie apocalypse, and why?',
  'What is a hidden talent nobody on campus knows you have?',
  'Have you ever accidentally sent a message to the wrong group chat? What happened?',
  'What was your most memorable moment at college so far?',
  'If you had to swap phones with someone here for 10 minutes, who would you trust most?',
  'What song is currently your secret guilty pleasure on repeat?',
  'What is the boldest goal you want to achieve before graduating?',
  'If you could erase one embarrassing memory from this year, which one would it be?',
  'Who makes you laugh the hardest in this group?',
  'Have you ever pretended to understand something in class when you were completely lost?',
  'What is the weirdest food combination you genuinely enjoy?',
];

const DARE_PROMPTS: string[] = [
  'Turn on your Voice Mic for 10 seconds and deliver a dramatic movie trailer intro for this group!',
  'Drop 3 hype emojis in Live Reactions right now and compliment the person above you in chat.',
  'Speak your next 3 in-game chat messages using only questions.',
  'Do your best motivational coach speech in Voice Chat about winning the next Ludo match!',
  'Share your funniest campus story or meme reference in the room chat within 20 seconds.',
  'Type a 1-sentence poem dedicated to the Room Host inside the live chat drawer.',
  'Keep a straight face while everyone sends 😂 reactions for 10 seconds!',
  'Announce the next player’s turn in Voice Chat like a stadium sports commentator.',
  'Send a bold prediction in chat about who will top the JIT Leaderboard this week.',
  'Hum the chorus of your favorite song in Voice Chat and let others guess the title!',
  'Give a 10-second shoutout to a friend in the room using only positive adjectives.',
  'Type the alphabet backwards as fast as you can in the room chat without editing!',
];

interface TruthAndDareGameProps {
  players: RoomPlayer[];
  waitingCount: number;
  currentUserId: string;
  isHost: boolean;
  isSeatedActivePlayer: boolean;
  state: TruthAndDareState | null;
  onUpdateState: (next: TruthAndDareState, status?: 'in_game' | 'finished') => void;
  onRoundAward: (points: number, summary: string) => void;
  onOpenHostPanel?: () => void;
}

export const TruthAndDareGame: React.FC<TruthAndDareGameProps> = ({
  players,
  waitingCount,
  currentUserId,
  isHost,
  isSeatedActivePlayer,
  state,
  onUpdateState,
  onRoundAward,
  onOpenHostPanel,
}) => {
  const [customPromptDraft, setCustomPromptDraft] = useState('');
  const [pendingChoice, setPendingChoice] = useState<'truth' | 'dare'>('truth');
  const [isSpinningAnim, setIsSpinningAnim] = useState(false);

  const activePlayers = players.length > 0 ? players : [];
  const currentRound = state?.round || 1;
  const phase = state?.phase || 'spinning';
  const myPlayer = activePlayers.find((p) => p.id === currentUserId);
  const canOperateRound = isHost || isSeatedActivePlayer;
  const isMyTurn = state ? state.activePlayerId === currentUserId || isHost : canOperateRound;

  const pickRandomPlayer = (): RoomPlayer | null => {
    if (activePlayers.length === 0) return null;
    if (activePlayers.length === 1) return activePlayers[0];
    const pool = activePlayers.filter((p) => p.id !== state?.activePlayerId);
    const list = pool.length > 0 ? pool : activePlayers;
    return list[Math.floor(Math.random() * list.length)];
  };

  const handleSpinBottle = () => {
    if (!canOperateRound || activePlayers.length === 0 || isSpinningAnim) return;
    setIsSpinningAnim(true);
    const nextRoundNum = state && phase === 'round_complete' ? state.round + 1 : state?.round || 1;

    window.setTimeout(() => {
      setIsSpinningAnim(false);
      const chosen = pickRandomPlayer() || activePlayers[0];
      onUpdateState({
        round: nextRoundNum,
        phase: 'choosing',
        activePlayerId: chosen.id,
        activePlayerName: chosen.name,
        activePlayerAvatar: chosen.avatar,
        choiceType: null,
        promptSource: null,
        promptText: '',
        history: state?.history || [],
        updatedAtMs: Date.now(),
      });
    }, 650);
  };

  const handleSystemChoice = (choiceType: 'truth' | 'dare') => {
    if (!state || !isMyTurn) return;
    const bank = choiceType === 'truth' ? TRUTH_PROMPTS : DARE_PROMPTS;
    const picked = bank[Math.floor(Math.random() * bank.length)];
    onUpdateState({
      ...state,
      phase: 'performing',
      choiceType,
      promptSource: 'system',
      promptText: picked,
      customAuthorName: 'JIT System Generator',
      updatedAtMs: Date.now(),
    });
  };

  const handleStartCustomChoice = (choiceType: 'truth' | 'dare') => {
    if (!state || !canOperateRound) return;
    setPendingChoice(choiceType);
    setCustomPromptDraft('');
    onUpdateState({
      ...state,
      phase: 'writing_custom',
      choiceType,
      promptSource: 'custom',
      updatedAtMs: Date.now(),
    });
  };

  const handleSubmitCustomPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state || !customPromptDraft.trim()) return;
    const finalChoice = state.choiceType || pendingChoice;
    onUpdateState({
      ...state,
      phase: 'performing',
      choiceType: finalChoice,
      promptSource: 'custom',
      promptText: customPromptDraft.trim().slice(0, 260),
      customAuthorName: myPlayer?.name || 'Room Player',
      updatedAtMs: Date.now(),
    });
    setCustomPromptDraft('');
  };

  const handleCompleteRound = (roundStatus: 'completed' | 'skipped') => {
    if (!state || !state.choiceType) return;
    const item: TruthAndDareHistoryItem = {
      id: `td_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      round: state.round,
      playerId: state.activePlayerId,
      playerName: state.activePlayerName,
      choiceType: state.choiceType,
      promptSource: state.promptSource || 'system',
      promptText: state.promptText,
      customAuthor: state.customAuthorName,
      status: roundStatus,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const nextHistory = [item, ...(state.history || [])].slice(0, 12);
    onUpdateState(
      {
        ...state,
        phase: 'round_complete',
        history: nextHistory,
        updatedAtMs: Date.now(),
      },
      'finished'
    );

    if (roundStatus === 'completed' && (state.activePlayerId === currentUserId || isHost)) {
      onRoundAward(15, `Completed ${state.choiceType.toUpperCase()} Round #${state.round}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Open Group Roster Strip */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-r from-fuchsia-50 via-purple-50 to-indigo-50 dark:from-fuchsia-950/30 dark:via-purple-950/30 dark:to-indigo-950/30 border border-fuchsia-200/80 dark:border-fuchsia-800/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-600 to-pink-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-slate-900 dark:text-white">
              Truth & Dare · Round #{currentRound}
            </p>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
              {activePlayers.length} Seated Players {waitingCount > 0 ? `· ${waitingCount} in Waiting Seat` : '· Open Group Live'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center -space-x-2">
            {activePlayers.slice(0, 5).map((p) => {
              const isSpotlight = state?.activePlayerId === p.id;
              return (
                <img
                  key={p.id}
                  src={p.avatar || APP_CONFIG.logoUrl}
                  alt={p.name}
                  title={p.name}
                  className={`w-8 h-8 rounded-full object-cover border-2 transition-transform ${
                    isSpotlight
                      ? 'border-fuchsia-500 scale-110 z-10 ring-2 ring-fuchsia-400/50'
                      : 'border-white dark:border-slate-900'
                  }`}
                />
              );
            })}
          </div>

          {onOpenHostPanel && (
            <button
              type="button"
              onClick={onOpenHostPanel}
              className="px-3 py-1.5 min-h-[36px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Users className="w-3.5 h-3.5 text-fuchsia-600" />
              <span>Seats ({activePlayers.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Spotlight Card */}
      <div className="p-5 sm:p-6 rounded-3xl bg-slate-900 text-white border border-slate-800 shadow-xl relative overflow-hidden">
        {/* Subtle ambient accent */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-fuchsia-600/20 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-blue-600/20 blur-2xl pointer-events-none" />

        {/* Phase 1: Spin Bottle / Pick Player */}
        {phase === 'spinning' && (
          <div className="relative z-10 text-center py-6 space-y-4">
            <div
              className={`w-20 h-20 mx-auto rounded-full bg-gradient-to-tr from-fuchsia-600 to-amber-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/30 ${
                isSpinningAnim ? 'animate-spin' : ''
              }`}
            >
              <RotateCw className="w-9 h-9 text-white" />
            </div>

            <div>
              <h4 className="text-lg sm:text-xl font-black">
                {isSpinningAnim ? 'Spinning the Spotlight...' : 'Ready to Spin Truth & Dare!'}
              </h4>
              <p className="mt-1 text-xs text-slate-300 max-w-md mx-auto">
                Spin to spotlight a seated player. Pick <strong>System Choice</strong> for instant prompts or <strong>Own Choice</strong> to write custom challenges!
              </p>
            </div>

            <button
              type="button"
              onClick={handleSpinBottle}
              disabled={!canOperateRound || isSpinningAnim}
              className="px-6 py-3 min-h-[44px] rounded-2xl bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 disabled:opacity-40 text-white text-xs sm:text-sm font-black shadow-lg transition-all active:scale-95 whitespace-nowrap"
            >
              {isSpinningAnim ? 'Picking Player...' : 'Spin Turn Spotlight'}
            </button>
          </div>
        )}

        {/* Phase 2: Choose Truth or Dare + System vs Own Choice */}
        {phase === 'choosing' && state && (
          <div className="relative z-10 text-center space-y-5 py-2">
            <div className="flex flex-col items-center">
              <img
                src={state.activePlayerAvatar || APP_CONFIG.logoUrl}
                alt={state.activePlayerName}
                className="w-16 h-16 rounded-full object-cover border-4 border-fuchsia-500 shadow-lg"
              />
              <span className="mt-2.5 text-[11px] font-bold uppercase tracking-widest text-fuchsia-300">
                Spotlight Player
              </span>
              <h4 className="text-lg sm:text-xl font-black text-white">
                {state.activePlayerName}
                {state.activePlayerId === currentUserId ? ' (Your Turn!)' : ''}
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg mx-auto">
              {/* TRUTH CARD */}
              <div className="p-4 rounded-2xl bg-blue-950/60 border border-blue-500/40 space-y-3 text-left">
                <div className="flex items-center gap-2 text-blue-300 font-black text-sm">
                  <MessageCircleHeart className="w-4 h-4" />
                  <span>TRUTH</span>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={!isMyTurn}
                    onClick={() => handleSystemChoice('truth')}
                    className="w-full py-2.5 min-h-[44px] px-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>System Choice</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canOperateRound}
                    onClick={() => handleStartCustomChoice('truth')}
                    className="w-full py-2 min-h-[40px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-blue-500/30 text-blue-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Own Choice</span>
                  </button>
                </div>
              </div>

              {/* DARE CARD */}
              <div className="p-4 rounded-2xl bg-fuchsia-950/60 border border-fuchsia-500/40 space-y-3 text-left">
                <div className="flex items-center gap-2 text-fuchsia-300 font-black text-sm">
                  <Flame className="w-4 h-4" />
                  <span>DARE</span>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={!isMyTurn}
                    onClick={() => handleSystemChoice('dare')}
                    className="w-full py-2.5 min-h-[44px] px-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>System Choice</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canOperateRound}
                    onClick={() => handleStartCustomChoice('dare')}
                    className="w-full py-2 min-h-[40px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-fuchsia-500/30 text-fuchsia-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Own Choice</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Phase 3: Writing Own Choice Custom Prompt */}
        {phase === 'writing_custom' && state && (
          <form onSubmit={handleSubmitCustomPrompt} className="relative z-10 max-w-lg mx-auto space-y-4 py-2">
            <div className="text-center">
              <span className="text-[11px] font-bold uppercase tracking-widest text-amber-300">
                Own Choice · {(state.choiceType || pendingChoice).toUpperCase()} for {state.activePlayerName}
              </span>
              <h4 className="text-base font-black mt-1">
                Write a Custom {(state.choiceType || pendingChoice) === 'truth' ? 'Truth Question' : 'Dare Challenge'}
              </h4>
            </div>

            <textarea
              rows={3}
              value={customPromptDraft}
              onChange={(e) => setCustomPromptDraft(e.target.value)}
              placeholder={`Type your custom ${state.choiceType || pendingChoice} prompt here...`}
              maxLength={260}
              className="w-full p-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleSystemChoice(state.choiceType || pendingChoice)}
                className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors whitespace-nowrap"
              >
                Use System Prompt Instead
              </button>

              <button
                type="submit"
                disabled={!customPromptDraft.trim()}
                className="px-5 py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 disabled:opacity-40 text-white text-xs font-black transition-all whitespace-nowrap"
              >
                Send Challenge Live
              </button>
            </div>
          </form>
        )}

        {/* Phase 4: Active Challenge Card */}
        {phase === 'performing' && state && (
          <div className="relative z-10 max-w-lg mx-auto text-center space-y-5 py-2">
            <div className="flex items-center justify-center gap-2">
              <span
                className={`px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider ${
                  state.choiceType === 'truth'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white'
                }`}
              >
                {state.choiceType}
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-[11px] font-bold">
                {state.promptSource === 'custom'
                  ? `Own Choice (${state.customAuthorName || 'Player'})`
                  : 'System Choice'}
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Challenge for {state.activePlayerName}
              </p>
              <p className="text-base sm:text-lg font-bold text-white leading-relaxed">
                “{state.promptText}”
              </p>
            </div>

            {isMyTurn ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => handleCompleteRound('completed')}
                  className="px-5 py-2.5 min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Completed (+15 Pts)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCompleteRound('skipped')}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <SkipForward className="w-4 h-4" />
                  <span>Skip Turn</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Waiting for {state.activePlayerName} (or Host) to complete this challenge live!
              </p>
            )}
          </div>
        )}

        {/* Phase 5: Round Complete -> Spin Next OR Host Rotate Waiting Players */}
        {phase === 'round_complete' && state && (
          <div className="relative z-10 max-w-lg mx-auto text-center space-y-4 py-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base sm:text-lg font-black">
                Round #{state.round} Finished!
              </h4>
              <p className="text-xs text-slate-300 mt-1">
                {state.activePlayerName} finished their {state.choiceType?.toUpperCase()} turn.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleSpinBottle}
                disabled={!canOperateRound}
                className="px-5 py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 disabled:opacity-40 text-white text-xs font-black flex items-center gap-1.5 transition-all whitespace-nowrap"
              >
                <RotateCw className="w-4 h-4" />
                <span>Next Spin (Round #{state.round + 1})</span>
              </button>

              {isHost && onOpenHostPanel && waitingCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenHostPanel}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Rotate Waiting Players ({waitingCount})</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Round History Feed */}
      {state?.history && state.history.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
          <h5 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Recent Truth & Dare Log
          </h5>
          <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
            {state.history.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-black uppercase text-[10px] ${
                        item.choiceType === 'truth'
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-fuchsia-600 dark:text-fuchsia-400'
                      }`}
                    >
                      {item.choiceType}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                      {item.playerName}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({item.promptSource === 'custom' ? 'Own Choice' : 'System'})
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
                    {item.promptText}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold shrink-0 ${
                    item.status === 'completed'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400'
                  }`}
                >
                  {item.status === 'completed' ? 'Done' : 'Skipped'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
