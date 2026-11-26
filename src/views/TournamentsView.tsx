/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Tournament, TournamentTimeSlot, NavTab } from '../types';
import { INITIAL_TOURNAMENTS } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import { fetchAiQuizRound } from '../services/aiClient';
import { QuizQuestion, pickShuffledQuizQuestions } from '../services/gameAIEngine';
import {
  Trophy,
  Users,
  Calendar,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldAlert,
  Play,
  Flame,
  Coins,
  X,
  Timer,
  Loader2,
  ChevronRight,
  Check,
  RefreshCw,
} from 'lucide-react';

interface TournamentsViewProps {
  onNavigate: (tab: NavTab) => void;
}

type TournamentFilter = 'all' | 'live' | 'upcoming' | 'registered';

interface StoredRegistration {
  tournamentId: string;
  slotId: string;
  slotLabel: string;
  registeredAtIso: string;
}

function getDefaultSlots(tour: Tournament): TournamentTimeSlot[] {
  if (tour.timeSlots && tour.timeSlots.length > 0) return tour.timeSlots;
  return [
    { id: `${tour.id}_s1`, label: 'Today · 6:30 PM IST', seatsTaken: 6, maxSeats: 10 },
    { id: `${tour.id}_s2`, label: 'Tomorrow · 5:00 PM IST', seatsTaken: 4, maxSeats: 10 },
    { id: `${tour.id}_s3`, label: 'Tomorrow · 8:30 PM IST', seatsTaken: 3, maxSeats: 10 },
  ];
}

export const TournamentsView: React.FC<TournamentsViewProps> = ({ onNavigate }) => {
  const { currentUser, spendRewardPoints, awardGameResult } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>(INITIAL_TOURNAMENTS);
  const [filterTab, setFilterTab] = useState<TournamentFilter>('all');

  // Registered schedule slots per tournament
  const [registrations, setRegistrations] = useState<Record<string, StoredRegistration>>({});
  // Currently selected slot ID per tournament before confirming registration
  const [selectedSlotByTour, setSelectedSlotByTour] = useState<Record<string, string>>({});

  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Embedded Live AI Quiz Tournament Arena State (70% CS / 30% General Trivia)
  const [isQuizArenaOpen, setIsQuizArenaOpen] = useState(false);
  const [quizTitle, setQuizTitle] = useState('AI Tech & Campus Brainiacs Qualifier');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>(() =>
    pickShuffledQuizQuestions(10)
  );
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSource, setQuizSource] = useState<'ai' | 'curated-70-30'>('curated-70-30');
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelectedOpt, setQuizSelectedOpt] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizCorrectCount, setQuizCorrectCount] = useState(0);
  const [quizTimer, setQuizTimer] = useState(15);
  const [quizFinished, setQuizFinished] = useState(false);
  const seenQuizRef = useRef<string[]>([]);

  // Load persisted registrations cleanly per user
  useEffect(() => {
    const uid = currentUser?.id || 'guest';
    try {
      const saved = localStorage.getItem(`jit_tournament_regs_v1_${uid}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          setRegistrations(parsed);
          return;
        }
      }
    } catch {
      // ignore parse failure
    }
    setRegistrations({
      tour_001: {
        tournamentId: 'tour_001',
        slotId: 'slot_ludo_2',
        slotLabel: 'Today · 8:30 PM IST',
        registeredAtIso: new Date().toISOString(),
      },
    });
  }, [currentUser?.id]);

  // Pre-select first open slot for every tournament
  useEffect(() => {
    setSelectedSlotByTour((prev) => {
      const next = { ...prev };
      for (const tour of tournaments) {
        if (!next[tour.id]) {
          const slots = getDefaultSlots(tour);
          const openSlot = slots.find((s) => s.seatsTaken < s.maxSeats) || slots[0];
          if (openSlot) next[tour.id] = openSlot.id;
        }
      }
      return next;
    });
  }, [tournaments]);

  const persistRegistrations = (next: Record<string, StoredRegistration>) => {
    setRegistrations(next);
    const uid = currentUser?.id || 'guest';
    try {
      localStorage.setItem(`jit_tournament_regs_v1_${uid}`, JSON.stringify(next));
    } catch {
      // ignore quota error
    }
  };

  const handleJoinOrUpdateSlot = (tour: Tournament) => {
    if (!currentUser) {
      setJoinError('Please sign in first to register for a tournament.');
      setTimeout(() => setJoinError(null), 3500);
      return;
    }

    const slots = getDefaultSlots(tour);
    const chosenSlotId = selectedSlotByTour[tour.id] || slots[0]?.id;
    const chosenSlot = slots.find((s) => s.id === chosenSlotId);
    if (!chosenSlot) {
      setJoinError('Please select a schedule time slot first.');
      setTimeout(() => setJoinError(null), 3500);
      return;
    }

    const existingReg = registrations[tour.id];
    if (existingReg) {
      // Free schedule slot switch if not the same slot
      if (existingReg.slotId === chosenSlot.id) return;
      if (chosenSlot.seatsTaken >= chosenSlot.maxSeats) {
        setJoinError('Selected time slot is full. Please pick another open time slot.');
        setTimeout(() => setJoinError(null), 3500);
        return;
      }
      const nextRegs = {
        ...registrations,
        [tour.id]: {
          ...existingReg,
          slotId: chosenSlot.id,
          slotLabel: chosenSlot.label,
        },
      };
      persistRegistrations(nextRegs);
      setTournaments((prev) =>
        prev.map((t) =>
          t.id === tour.id && t.timeSlots
            ? {
                ...t,
                timeSlots: t.timeSlots.map((s) => {
                  if (s.id === existingReg.slotId) return { ...s, seatsTaken: Math.max(0, s.seatsTaken - 1) };
                  if (s.id === chosenSlot.id) return { ...s, seatsTaken: Math.min(s.maxSeats, s.seatsTaken + 1) };
                  return s;
                }),
              }
            : t
        )
      );
      setJoinError(null);
      setJoinSuccess(`Schedule updated for "${tour.title}" -> ${chosenSlot.label}.`);
      setTimeout(() => setJoinSuccess(null), 4000);
      return;
    }

    if (chosenSlot.seatsTaken >= chosenSlot.maxSeats) {
      setJoinError('That time slot is currently full. Please select an open slot.');
      setTimeout(() => setJoinError(null), 3500);
      return;
    }

    const spendRes = spendRewardPoints(
      tour.entryFeePoints,
      `Tournament Entry: ${tour.title} (${chosenSlot.label})`,
      'tournament_entry'
    );
    if (!spendRes.success) {
      setJoinError(
        `Insufficient virtual points! Entry requires ${tour.entryFeePoints} Pts. Play games or claim daily rewards to earn more.`
      );
      setTimeout(() => setJoinError(null), 4500);
      return;
    }

    const nextRegs = {
      ...registrations,
      [tour.id]: {
        tournamentId: tour.id,
        slotId: chosenSlot.id,
        slotLabel: chosenSlot.label,
        registeredAtIso: new Date().toISOString(),
      },
    };
    persistRegistrations(nextRegs);

    setTournaments((prev) =>
      prev.map((t) =>
        t.id === tour.id
          ? {
              ...t,
              registeredCount: t.registeredCount + 1,
              timeSlots: t.timeSlots?.map((s) =>
                s.id === chosenSlot.id
                  ? { ...s, seatsTaken: Math.min(s.maxSeats, s.seatsTaken + 1) }
                  : s
              ),
            }
          : t
      )
    );

    setJoinError(null);
    setJoinSuccess(
      `Slot confirmed for "${tour.title}" (${chosenSlot.label})! New balance: ${spendRes.newTotal} Pts.`
    );
    setTimeout(() => setJoinSuccess(null), 4500);
  };

  // Start / Refresh Live AI Quiz Tournament Round (Strict 70% CS / 30% General)
  const launchAiQuizArena = async (title = 'AI Tech & Campus Brainiacs Qualifier') => {
    setQuizTitle(title);
    setIsQuizArenaOpen(true);
    setQuizFinished(false);
    setQuizIndex(0);
    setQuizSelectedOpt(null);
    setQuizScore(0);
    setQuizCorrectCount(0);
    setQuizTimer(15);
    setQuizLoading(true);
    try {
      const res = await fetchAiQuizRound({
        count: 10,
        difficulty: 'medium',
        excludeQuestions: seenQuizRef.current.slice(-30),
        topicHint: title,
      });
      if (res.questions.length > 0) {
        seenQuizRef.current = [...seenQuizRef.current, ...res.questions.map((q) => q.q)].slice(-40);
        setQuizQuestions(res.questions);
        setQuizSource(res.source);
      }
    } finally {
      setQuizLoading(false);
    }
  };

  const handleAnswerTournamentQuiz = (optIdx: number | null) => {
    if (!isQuizArenaOpen || quizFinished || quizSelectedOpt !== null) return;
    setQuizSelectedOpt(optIdx);

    const curr = quizQuestions[quizIndex];
    const isRight = optIdx !== null && optIdx === curr.answer;
    const ptsGained = isRight ? 100 + Math.min(20, quizTimer) : 0;
    const nextScore = quizScore + ptsGained;
    const nextCorrect = quizCorrectCount + (isRight ? 1 : 0);

    setQuizScore(nextScore);
    setQuizCorrectCount(nextCorrect);

    window.setTimeout(() => {
      if (quizIndex < quizQuestions.length - 1) {
        setQuizIndex((idx) => idx + 1);
        setQuizSelectedOpt(null);
        setQuizTimer(15);
      } else {
        setQuizFinished(true);
        const rewardPts = nextCorrect >= 7 ? 75 : nextCorrect >= 4 ? 40 : 15;
        if (currentUser) {
          void awardGameResult({
            gameId: 'quiz',
            gameName: 'AI Tournament Quiz',
            mode: 'solo',
            outcome: nextCorrect >= 5 ? 'win' : 'loss',
            pointsEarned: rewardPts,
            scoreSummary: `${nextCorrect}/${quizQuestions.length} (${nextScore} pts)`,
          });
        }
      }
    }, 950);
  };

  const answerTournamentQuizRef = React.useRef(handleAnswerTournamentQuiz);
  answerTournamentQuizRef.current = handleAnswerTournamentQuiz;

  useEffect(() => {
    if (!isQuizArenaOpen || quizLoading || quizFinished || quizSelectedOpt !== null) return;
    const id = window.setInterval(() => {
      setQuizTimer((t) => {
        if (t <= 1) {
          answerTournamentQuizRef.current(null);
          return 15;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isQuizArenaOpen, quizLoading, quizFinished, quizSelectedOpt]);

  const liveCount = tournaments.filter((t) => t.status === 'live').length;
  const upcomingCount = tournaments.filter((t) => t.status === 'upcoming').length;
  const myRegCount = Object.keys(registrations).length;

  const filteredTournaments = useMemo(() => {
    if (filterTab === 'live') return tournaments.filter((t) => t.status === 'live');
    if (filterTab === 'upcoming') return tournaments.filter((t) => t.status === 'upcoming');
    if (filterTab === 'registered') return tournaments.filter((t) => Boolean(registrations[t.id]));
    return tournaments;
  }, [tournaments, filterTab, registrations]);

  const quizCsCount = quizQuestions.filter((q) => q.domain === 'cs').length;
  const quizGeneralCount = quizQuestions.length - quizCsCount;

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full">
      {/* 1. Editorial Championship Header & Quick Stats */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-900 dark:bg-slate-900 text-white border border-slate-800 shadow-xl p-6 sm:p-8">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-xl space-y-3">
            <div className="flex items-center gap-2 text-amber-400">
              <Trophy className="w-4 h-4 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-widest">
                JIT Championship Leagues
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Scheduled Campus Brackets &amp; AI Quiz Leagues
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Pick an exact match schedule slot, track live prize pools, or launch the AI Quiz Qualifier powered by a strict 70% Computer Science &amp; 30% General Trivia split.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void launchAiQuizArena()}
                className="px-4 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                <span>Play AI Quiz Qualifier (70% CS / 30% Trivia)</span>
              </button>
              <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Virtual JIT Points Only · No Real Money</span>
              </div>
            </div>
          </div>

          {/* Clean KPI Grid (no rounded-full pill clutter) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3 shrink-0">
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80">
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                <Flame className="w-3 h-3" />
                Live Now
              </p>
              <p className="text-xl font-black font-mono tabular-nums mt-1">{liveCount}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                Upcoming
              </p>
              <p className="text-xl font-black font-mono tabular-nums mt-1">{upcomingCount}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                My Slots
              </p>
              <p className="text-xl font-black font-mono tabular-nums mt-1">{myRegCount}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Coins className="w-3 h-3" />
                Balance
              </p>
              <p className="text-xl font-black font-mono tabular-nums mt-1">
                {currentUser?.stats.rewardPoints ?? 0}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Alerts */}
      {joinSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{joinSuccess}</span>
        </div>
      )}

      {joinError && (
        <div
          role="alert"
          aria-live="polite"
          className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-2.5 text-xs font-medium text-red-800 dark:text-red-300"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{joinError}</span>
        </div>
      )}

      {/* 3. Filter Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-2xl overflow-x-auto max-w-full">
          {(
            [
              { id: 'all', label: `All (${tournaments.length})` },
              { id: 'live', label: `Live Matches (${liveCount})` },
              { id: 'upcoming', label: `Upcoming (${upcomingCount})` },
              { id: 'registered', label: `My Schedule (${myRegCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterTab(tab.id)}
              className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                filterTab === tab.id
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          Select any open match time slot below to reserve your bracket seat.
        </p>
      </div>

      {/* 4. Tournament Cards Grid */}
      {filteredTournaments.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-10 text-center space-y-3">
          <Calendar className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            No tournaments in this view
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Switch tabs above to view live campus leagues and reserve a schedule time slot.
          </p>
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
          >
            Show All Tournaments
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredTournaments.map((tour) => {
            const game = APP_CONFIG.games.find((g) => g.id === tour.gameId);
            const slots = getDefaultSlots(tour);
            const reg = registrations[tour.id];
            const selectedSlotId = selectedSlotByTour[tour.id] || reg?.slotId || slots[0]?.id;
            const selectedSlot = slots.find((s) => s.id === selectedSlotId);
            const fillPercent = Math.min(
              100,
              Math.round((tour.registeredCount / Math.max(1, tour.totalSlots)) * 100)
            );
            const hasSlotChanged = Boolean(reg && selectedSlotId && reg.slotId !== selectedSlotId);

            return (
              <article
                key={tour.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between gap-5"
              >
                <div className="space-y-4">
                  {/* Card Top Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md uppercase tracking-wider ${
                            tour.status === 'live'
                              ? 'bg-red-600 text-white'
                              : 'bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300'
                          }`}
                        >
                          {tour.status === 'live' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                          )}
                          {tour.status === 'live' ? 'Live Now' : 'Upcoming'}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {game?.name || 'Tournament'}
                        </span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="text-slate-500 dark:text-slate-400 font-medium">
                          {tour.format || 'Official Bracket'}
                        </span>
                      </div>

                      <h3 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
                        {tour.title}
                      </h3>
                    </div>

                    {reg && (
                      <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Joined
                      </span>
                    )}
                  </div>

                  {tour.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {tour.description}
                    </p>
                  )}

                  {/* Financial & Participant Metrics */}
                  <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Entry Fee
                      </p>
                      <p className="text-sm font-black font-mono text-slate-900 dark:text-white tabular-nums mt-0.5">
                        {tour.entryFeePoints} Pts
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Prize Pool
                      </p>
                      <p className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                        {tour.prizePoolPoints} Pts
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Participants
                      </p>
                      <p className="text-sm font-black font-mono text-slate-900 dark:text-white tabular-nums mt-0.5">
                        {tour.registeredCount}/{tour.totalSlots}
                      </p>
                    </div>
                  </div>

                  {/* Bracket Capacity Progress */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Users className="w-3.5 h-3.5" />
                        {tour.startDate}
                      </span>
                      <span className="font-mono font-bold">{fillPercent}% Filled</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          fillPercent >= 85 ? 'bg-amber-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${fillPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Interactive Time / Schedule Slot Picker */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Select Time / Schedule Slot</span>
                      </label>
                      {reg && (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          Active: {reg.slotLabel}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {slots.map((slot) => {
                        const isFull = slot.seatsTaken >= slot.maxSeats && reg?.slotId !== slot.id;
                        const isPicked = selectedSlotId === slot.id;
                        const isConfirmedHere = reg?.slotId === slot.id;

                        return (
                          <button
                            key={slot.id}
                            type="button"
                            disabled={isFull}
                            onClick={() =>
                              setSelectedSlotByTour((prev) => ({ ...prev, [tour.id]: slot.id }))
                            }
                            className={`px-3 py-2 min-h-[44px] rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                              isPicked
                                ? 'border-blue-600 bg-blue-50/80 dark:bg-blue-950/50 text-blue-900 dark:text-white ring-1 ring-blue-600'
                                : isFull
                                ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-400 opacity-60 cursor-not-allowed'
                                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold truncate">{slot.label}</p>
                              <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                {isConfirmedHere
                                  ? 'Your Confirmed Slot'
                                  : isFull
                                  ? 'Slot Full'
                                  : `${slot.maxSeats - slot.seatsTaken} seats left`}
                              </p>
                            </div>
                            {isPicked && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Action Footer */}
                <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  {reg && !hasSlotChanged ? (
                    <div className="flex-1 min-w-[160px] flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="truncate">Confirmed · {reg.slotLabel}</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleJoinOrUpdateSlot(tour)}
                      disabled={!selectedSlot || (selectedSlot.seatsTaken >= selectedSlot.maxSeats && reg?.slotId !== selectedSlot.id)}
                      className="flex-1 min-w-[170px] px-4 py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                    >
                      <span>{hasSlotChanged ? 'Update Time Slot' : 'Confirm Slot & Register'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {tour.gameId === 'quiz' ? (
                    <button
                      type="button"
                      onClick={() => void launchAiQuizArena(tour.title)}
                      className="px-4 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Play AI Quiz Round</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate('games')}
                      className="px-4 py-2.5 min-h-[44px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors"
                    >
                      Open Game Hub
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 5. Live AI Quiz Tournament Arena Modal (Strict 70% CS / 30% General Trivia) */}
      {isQuizArenaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 animate-in fade-in">
          <div className="w-full max-w-xl max-h-[92dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Quiz &amp; Trivia Bot · 70% CS / 30% Trivia</span>
                </div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                  {quizTitle}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Round Composition: {quizCsCount} Computer Science (70%) · {quizGeneralCount} General Trivia (30%)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsQuizArenaOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close AI Quiz Arena"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {quizLoading ? (
              <div className="py-14 text-center space-y-3">
                <Loader2 className="w-9 h-9 animate-spin text-indigo-600 mx-auto" />
                <p className="text-sm font-bold text-slate-800 dark:text-white">
                  Generating Unique Tournament Quiz Set...
                </p>
                <p className="text-xs text-slate-500">
                  Balancing 70% Computer Science &amp; 30% General Trivia questions via AI
                </p>
              </div>
            ) : !quizFinished && quizQuestions[quizIndex] ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">
                    Question {quizIndex + 1} / {quizQuestions.length}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 font-mono px-2.5 py-1 rounded-lg ${
                      quizTimer <= 5
                        ? 'bg-red-100 dark:bg-red-950/60 text-red-600 animate-pulse'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300'
                    }`}
                  >
                    <Timer className="w-3.5 h-3.5" />
                    {quizTimer}s
                  </span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    Score: {quizScore}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                    <span className="text-blue-600 dark:text-blue-400">
                      {quizQuestions[quizIndex].category}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {quizQuestions[quizIndex].domain === 'cs' ? 'Computer Science (70%)' : 'General Trivia (30%)'}
                    </span>
                  </div>
                  <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug">
                    {quizQuestions[quizIndex].q}
                  </h4>
                </div>

                <div className="space-y-2">
                  {quizQuestions[quizIndex].options.map((opt, idx) => {
                    const isPicked = quizSelectedOpt === idx;
                    const isCorrect = idx === quizQuestions[quizIndex].answer;
                    let cls =
                      'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-indigo-400';
                    if (quizSelectedOpt !== null) {
                      if (isCorrect) {
                        cls =
                          'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold';
                      } else if (isPicked) {
                        cls =
                          'bg-red-50 dark:bg-red-950/60 border-red-500 text-red-600 font-bold';
                      }
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={quizSelectedOpt !== null}
                        onClick={() => handleAnswerTournamentQuiz(idx)}
                        className={`w-full p-3.5 min-h-[44px] rounded-xl border text-left text-xs transition-all flex items-center justify-between ${cls}`}
                      >
                        <span>{opt}</span>
                        <ChevronRight className="w-4 h-4 opacity-40 shrink-0" />
                      </button>
                    );
                  })}
                </div>

                {quizSelectedOpt !== null && quizQuestions[quizIndex].explanation && (
                  <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/70 dark:border-indigo-900/50 text-xs text-indigo-900 dark:text-indigo-200">
                    {quizQuestions[quizIndex].explanation}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-4 text-center space-y-4">
                <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                <div>
                  <h4 className="text-lg font-extrabold text-slate-900 dark:text-white">
                    Qualifier Complete!
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {quizSource === 'ai' ? 'AI-Generated Round' : '70% CS / 30% General Round'} ·{' '}
                    Answered {quizCorrectCount} / {quizQuestions.length} correctly
                  </p>
                </div>

                <div className="inline-flex items-center gap-6 px-6 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">
                  <div>
                    <p className="text-[10px] uppercase text-slate-400">Final Score</p>
                    <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {quizScore}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-slate-400">Accuracy</p>
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {Math.round((quizCorrectCount / Math.max(1, quizQuestions.length)) * 100)}%
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => void launchAiQuizArena(quizTitle)}
                    className="px-4 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>New Unique AI Quiz Round</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsQuizArenaOpen(false)}
                    className="px-4 py-2.5 min-h-[44px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold"
                  >
                    Back to Tournaments
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
