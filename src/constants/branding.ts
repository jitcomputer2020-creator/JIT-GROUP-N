/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const APP_CONFIG = {
  name: 'JIT GROUP',
  fullName: 'JIT GROUP - Jharna Institute of Technology',
  tagline: 'Social Media, Real-time Chat, Calling & Multiplayer Gaming',
  logoUrl: '/assets/aistudio/image_e64e54f2.png',
  fallbackLogoText: 'JIT',
  version: '1.0.0',
  inactivityLimitDays: 180,
  colors: {
    primaryBlue: '#1d4ed8',
    primaryGreen: '#16a34a',
    accentOrange: '#ea580c',
  },
  socialFeatures: [
    'Social News Feed & Stories',
    'Full-screen Vertical Reels',
    'Private 1-on-1 & Group Chats',
    'WebRTC HD Voice & Video Calling',
    '6 Online Multiplayer Games',
    'Competitive Tournaments',
    'Virtual Rewards & Daily Streaks',
    '180-Day Automated Inactivity Cleanup',
  ],
  games: [
    { id: 'ludo', name: 'Ludo', players: '2-4 Players', category: 'Board', icon: 'Dice5', color: 'from-amber-500 to-red-500' },
    { id: 'tictactoe', name: 'Tic Tac Toe', players: '2 Players', category: 'Quick Match', icon: 'Grid3x3', color: 'from-blue-500 to-indigo-600' },
    { id: 'quiz', name: 'Quiz Battle', players: '1-4 Players', category: 'Trivia', icon: 'HelpCircle', color: 'from-purple-500 to-pink-500' },
    { id: 'chess', name: 'Chess', players: '2 Players', category: 'Strategy', icon: 'Crown', color: 'from-slate-700 to-slate-900' },
    { id: 'snake_ladder', name: 'Snake & Ladder', players: '2 Players', category: 'Classic', icon: 'TrendingUp', color: 'from-emerald-500 to-teal-600' },
    { id: 'carrom', name: 'Carrom', players: '2 Players', category: 'Arcade Physics', icon: 'Disc', color: 'from-yellow-600 to-amber-700' },
    { id: 'spin_wheel', name: 'Lucky Spin', players: 'Daily Bonus', category: 'Rewards', icon: 'Disc3', color: 'from-rose-500 to-amber-500' },
  ],
};
