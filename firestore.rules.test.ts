/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firestore Security Rules Verification Suite (Phase 0 TDD)
 * Validates Dirty Dozen adversarial payloads against firestore.rules constraints.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'list' | 'get' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, any>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Blanket List Enumeration (phone_index)',
    operation: 'list',
    path: '/phone_index',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Blanket List Enumeration (profiles)',
    operation: 'list',
    path: '/profiles',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Document ID Poisoning (phone_index non-numeric key)',
    operation: 'create',
    path: '/phone_index/invalid_phone_key',
    payload: { profileId: 'usr_jit_12345678' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Document ID Poisoning (profiles illegal chars)',
    operation: 'create',
    path: '/profiles/bad$id!name',
    payload: { id: 'bad$id!name' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow / Ghost Field Injection (isAdmin)',
    operation: 'create',
    path: '/profiles/usr_jit_valid001',
    payload: {
      id: 'usr_jit_valid001',
      contactNumber: '9874492871',
      phoneKey: '9874492871',
      fullName: 'Attacker',
      address: 'Campus',
      joinedAt: '2026-11-13T00:00:00Z',
      lastLoginAt: '2026-11-13T00:00:00Z',
      lastLogin: '2026-11-13T00:00:00Z',
      isAdmin: true,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned Phone Index Write without Profile',
    operation: 'create',
    path: '/phone_index/9874492871',
    payload: {
      profileId: 'usr_jit_nonexistent',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Timestamp Spoofing on Create (backdated lastActiveAt)',
    operation: 'create',
    path: '/profiles/usr_jit_valid002',
    payload: {
      id: 'usr_jit_valid002',
      lastActiveAt: new Date('2020-01-01T00:00:00Z'),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Timestamp Spoofing on Update',
    operation: 'update',
    path: '/profiles/usr_jit_valid001',
    payload: {
      lastActiveAt: new Date('2099-01-01T00:00:00Z'),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable Identity Hijack (mutating phoneKey)',
    operation: 'update',
    path: '/profiles/usr_jit_valid001',
    payload: {
      phoneKey: '9999999999',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Denial-of-Wallet String Bomb (fullName > 120 chars)',
    operation: 'update',
    path: '/profiles/usr_jit_valid001',
    payload: {
      fullName: 'A'.repeat(200),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value Type Poisoning (negative rewardPoints)',
    operation: 'update',
    path: '/profiles/usr_jit_valid001',
    payload: {
      stats: { rewardPoints: -500 },
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Premature Account Deletion (< 180 days)',
    operation: 'delete',
    path: '/profiles/usr_jit_valid001',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Leaderboard Point Inflation (> 1000000)',
    operation: 'update',
    path: '/leaderboard/usr_jit_valid001',
    payload: {
      rewardPoints: 9999999,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Match History Tampering (immutable update denied)',
    operation: 'update',
    path: '/match_history/match_jit_001',
    payload: {
      pointsEarned: 500,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
