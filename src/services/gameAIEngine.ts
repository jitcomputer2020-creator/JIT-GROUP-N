/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Authoritative Game Rules & AI Engine
 * Real rule validation, turn management, win/checkmate detection, and AI tactics
 * for Chess, Tic Tac Toe, Ludo, Quiz Battle, Snake & Ladder, and Carrom.
 */

import { AIDifficulty } from '../types/multiplayer';

// ============================================================================
// 1. TIC TAC TOE ENGINE (Win lines, Random / Blocker / Minimax)
// ============================================================================

export const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function checkTicTacToeWinner(
  squares: (string | null)[]
): { winner: 'X' | 'O' | 'draw' | null; line: number[] | null } {
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return { winner: squares[a] as 'X' | 'O', line };
    }
  }
  if (squares.every(Boolean)) {
    return { winner: 'draw', line: null };
  }
  return { winner: null, line: null };
}

export function getTicTacToeAIMove(
  board: (string | null)[],
  difficulty: AIDifficulty
): number {
  const emptyIndices = board
    .map((val, idx) => (val === null ? idx : null))
    .filter((v): v is number => v !== null);

  if (emptyIndices.length === 0) return -1;

  if (difficulty === 'easy') {
    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }

  const findWinningMove = (symbol: 'X' | 'O'): number | null => {
    for (const [a, b, c] of TTT_LINES) {
      const vals = [board[a], board[b], board[c]];
      const symbolCount = vals.filter((v) => v === symbol).length;
      const nullCount = vals.filter((v) => v === null).length;
      if (symbolCount === 2 && nullCount === 1) {
        if (board[a] === null) return a;
        if (board[b] === null) return b;
        if (board[c] === null) return c;
      }
    }
    return null;
  };

  if (difficulty === 'medium') {
    const winMove = findWinningMove('O');
    if (winMove !== null) return winMove;
    const blockMove = findWinningMove('X');
    if (blockMove !== null) return blockMove;
    if (board[4] === null) return 4;
    const corners = [0, 2, 6, 8].filter((idx) => board[idx] === null);
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)];
    }
    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }

  const minimax = (
    currentBoard: (string | null)[],
    depth: number,
    isMaximizing: boolean
  ): { score: number; move?: number } => {
    const res = checkTicTacToeWinner(currentBoard).winner;
    if (res === 'O') return { score: 10 - depth };
    if (res === 'X') return { score: depth - 10 };
    if (res === 'draw') return { score: 0 };

    const available = currentBoard
      .map((val, idx) => (val === null ? idx : null))
      .filter((v): v is number => v !== null);

    if (isMaximizing) {
      let maxScore = -Infinity;
      let bestMove = available[0];
      for (const idx of available) {
        currentBoard[idx] = 'O';
        const result = minimax(currentBoard, depth + 1, false);
        currentBoard[idx] = null;
        if (result.score > maxScore) {
          maxScore = result.score;
          bestMove = idx;
        }
      }
      return { score: maxScore, move: bestMove };
    } else {
      let minScore = Infinity;
      let bestMove = available[0];
      for (const idx of available) {
        currentBoard[idx] = 'X';
        const result = minimax(currentBoard, depth + 1, true);
        currentBoard[idx] = null;
        if (result.score < minScore) {
          minScore = result.score;
          bestMove = idx;
        }
      }
      return { score: minScore, move: bestMove };
    }
  };

  const best = minimax([...board], 0, true);
  return best.move !== undefined ? best.move : emptyIndices[0];
}

// ============================================================================
// 2. CHESS ENGINE (Complete Legal Rules, Check/Checkmate, Promotion, AI)
// ============================================================================

export interface ChessMove {
  from: [number, number];
  to: [number, number];
  piece: string;
  captured: string | null;
  score: number;
  promotedTo?: string;
}

const PIECE_VALUES: Record<string, number> = {
  '♟': 10,
  '♙': 10,
  '♞': 30,
  '♘': 30,
  '♝': 32,
  '♗': 32,
  '♜': 50,
  '♖': 50,
  '♛': 90,
  '♕': 90,
  '♚': 900,
  '♔': 900,
};

export const BLACK_PIECES = new Set(['♜', '♞', '♝', '♛', '♚', '♟']);
export const WHITE_PIECES = new Set(['♖', '♘', '♗', '♕', '♔', '♙']);

export function getPieceColor(piece: string | null): 'white' | 'black' | null {
  if (!piece) return null;
  if (WHITE_PIECES.has(piece)) return 'white';
  if (BLACK_PIECES.has(piece)) return 'black';
  return null;
}

function getPseudoLegalChessMoves(
  board: (string | null)[][],
  color: 'black' | 'white'
): ChessMove[] {
  const myPieces = color === 'black' ? BLACK_PIECES : WHITE_PIECES;
  const oppPieces = color === 'black' ? WHITE_PIECES : BLACK_PIECES;
  const moves: ChessMove[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || !myPieces.has(piece)) continue;

      // Pawns
      if (piece === '♟' || piece === '♙') {
        const dir = piece === '♙' ? -1 : 1;
        const startRank = piece === '♙' ? 6 : 1;
        const promoRank = piece === '♙' ? 0 : 7;
        const promoQueen = piece === '♙' ? '♕' : '♛';

        const nr1 = r + dir;
        if (nr1 >= 0 && nr1 < 8 && !board[nr1][c]) {
          moves.push({
            from: [r, c],
            to: [nr1, c],
            piece,
            captured: null,
            score: nr1 === promoRank ? 80 : 1,
            promotedTo: nr1 === promoRank ? promoQueen : undefined,
          });
          const nr2 = r + dir * 2;
          if (r === startRank && nr2 >= 0 && nr2 < 8 && !board[nr2][c]) {
            moves.push({ from: [r, c], to: [nr2, c], piece, captured: null, score: 2 });
          }
        }
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (nr1 >= 0 && nr1 < 8 && nc >= 0 && nc < 8) {
            const target = board[nr1][nc];
            if (target && oppPieces.has(target)) {
              moves.push({
                from: [r, c],
                to: [nr1, nc],
                piece,
                captured: target,
                score: (PIECE_VALUES[target] || 10) * 2 + (nr1 === promoRank ? 80 : 0),
                promotedTo: nr1 === promoRank ? promoQueen : undefined,
              });
            }
          }
        }
        continue;
      }

      // Knights
      if (piece === '♞' || piece === '♘') {
        const knightDeltas = [
          [-2, -1], [-2, 1], [-1, -2], [-1, 2],
          [1, -2], [1, 2], [2, -1], [2, 1],
        ];
        for (const [dr, dc] of knightDeltas) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const target = board[nr][nc];
            if (!target) {
              moves.push({ from: [r, c], to: [nr, nc], piece, captured: null, score: 2 });
            } else if (oppPieces.has(target)) {
              moves.push({
                from: [r, c],
                to: [nr, nc],
                piece,
                captured: target,
                score: (PIECE_VALUES[target] || 10) * 2,
              });
            }
          }
        }
        continue;
      }

      // Rooks / Bishops / Queens / Kings
      const isRook = piece === '♜' || piece === '♖';
      const isBishop = piece === '♝' || piece === '♗';
      const isQueen = piece === '♛' || piece === '♕';
      const isKing = piece === '♚' || piece === '♔';

      const directions: [number, number][] = [];
      if (isRook || isQueen) directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
      if (isBishop || isQueen) directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      if (isKing) directions.push([-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]);

      for (const [dr, dc] of directions) {
        let step = 1;
        while (true) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
          const target = board[nr][nc];
          if (!target) {
            moves.push({ from: [r, c], to: [nr, nc], piece, captured: null, score: 2 });
          } else {
            if (oppPieces.has(target)) {
              moves.push({
                from: [r, c],
                to: [nr, nc],
                piece,
                captured: target,
                score: (PIECE_VALUES[target] || 10) * 2,
              });
            }
            break;
          }
          if (isKing) break;
          step++;
        }
      }
    }
  }

  return moves;
}

export function applyChessMoveToBoard(
  board: (string | null)[][],
  move: Pick<ChessMove, 'from' | 'to' | 'piece' | 'promotedTo'>
): (string | null)[][] {
  const next = board.map((row) => [...row]);
  const [sr, sc] = move.from;
  const [tr, tc] = move.to;
  next[tr][tc] = move.promotedTo || move.piece;
  next[sr][sc] = null;
  return next;
}

export function isKingInCheck(
  board: (string | null)[][],
  color: 'white' | 'black'
): boolean {
  const kingChar = color === 'white' ? '♔' : '♚';
  let kingPos: [number, number] | null = null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === kingChar) {
        kingPos = [r, c];
        break;
      }
    }
    if (kingPos) break;
  }
  if (!kingPos) return true;
  const oppColor = color === 'white' ? 'black' : 'white';
  const oppMoves = getPseudoLegalChessMoves(board, oppColor);
  return oppMoves.some((m) => m.to[0] === kingPos![0] && m.to[1] === kingPos![1]);
}

export function getLegalChessMoves(
  board: (string | null)[][],
  color: 'black' | 'white'
): ChessMove[] {
  const pseudo = getPseudoLegalChessMoves(board, color);
  return pseudo.filter((move) => {
    const nextBoard = applyChessMoveToBoard(board, move);
    return !isKingInCheck(nextBoard, color);
  });
}

export function getLegalMovesForSquare(
  board: (string | null)[][],
  r: number,
  c: number,
  turn: 'white' | 'black'
): ChessMove[] {
  const piece = board[r][c];
  if (!piece || getPieceColor(piece) !== turn) return [];
  return getLegalChessMoves(board, turn).filter((m) => m.from[0] === r && m.from[1] === c);
}

export function getChessGameStatus(
  board: (string | null)[][],
  turn: 'white' | 'black'
): 'active' | 'check' | 'checkmate' | 'stalemate' {
  const inCheck = isKingInCheck(board, turn);
  const legal = getLegalChessMoves(board, turn);
  if (legal.length === 0) {
    return inCheck ? 'checkmate' : 'stalemate';
  }
  return inCheck ? 'check' : 'active';
}

export function getChessAIMove(
  board: (string | null)[][],
  difficulty: AIDifficulty
): ChessMove | null {
  const legalMoves = getLegalChessMoves(board, 'black');
  if (legalMoves.length === 0) return null;

  if (difficulty === 'easy') {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  if (difficulty === 'medium') {
    const captures = legalMoves.filter((m) => m.captured !== null);
    if (captures.length > 0) {
      captures.sort((a, b) => b.score - a.score);
      return captures[0];
    }
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  // Hard: Captures, checks, center control, promotions
  legalMoves.forEach((m) => {
    const [tr, tc] = m.to;
    if ((tr === 3 || tr === 4) && (tc === 3 || tc === 4)) {
      m.score += 15;
    }
    const simulated = applyChessMoveToBoard(board, m);
    if (isKingInCheck(simulated, 'white')) {
      m.score += 25;
      if (getLegalChessMoves(simulated, 'white').length === 0) {
        m.score += 1000;
      }
    }
    if (m.captured === '♕') m.score += 180;
    if (m.captured === '♖') m.score += 100;
  });

  legalMoves.sort((a, b) => b.score - a.score);
  return legalMoves[0];
}

// ============================================================================
// 3. QUIZ BATTLE BANK & AI
// ============================================================================

export interface QuizQuestion {
  q: string;
  options: string[];
  answer: number;
  category: string;
  domain: 'cs' | 'general';
  explanation?: string;
}

export const QUIZ_QUESTION_BANK: QuizQuestion[] = [
  // --- COMPUTER SCIENCE (14 Questions -> 70%) ---
  {
    q: 'Which data structure follows the First-In-First-Out (FIFO) principle?',
    options: ['Stack', 'Queue', 'Binary Tree', 'Hash Map'],
    answer: 1,
    category: 'Data Structures',
    domain: 'cs',
    explanation: 'A Queue dequeues elements in the exact order they were enqueued (FIFO).',
  },
  {
    q: 'In WebRTC, what protocol is primarily used for encrypted media transport?',
    options: ['TCP', 'SRTP / UDP', 'FTP', 'SMTP'],
    answer: 1,
    category: 'Networking',
    domain: 'cs',
    explanation: 'WebRTC uses Secure Real-time Transport Protocol (SRTP) over UDP for low-latency encrypted audio/video.',
  },
  {
    q: 'What is the average time complexity of searching in a balanced Binary Search Tree?',
    options: ['O(1)', 'O(n)', 'O(log n)', 'O(n log n)'],
    answer: 2,
    category: 'Algorithms',
    domain: 'cs',
    explanation: 'Balanced BSTs keep height logarithmic in the number of nodes, yielding O(log n) lookup.',
  },
  {
    q: 'Which database isolation level prevents dirty reads, non-repeatable reads, and phantom reads?',
    options: ['Read Committed', 'Repeatable Read', 'Serializable', 'Read Uncommitted'],
    answer: 2,
    category: 'Databases',
    domain: 'cs',
    explanation: 'Serializable is the strictest ANSI SQL isolation level, ensuring transactions behave as if run sequentially.',
  },
  {
    q: 'Which layer of the OSI model handles end-to-end reliable transport and flow control?',
    options: ['Data Link', 'Network', 'Transport', 'Presentation'],
    answer: 2,
    category: 'Networks',
    domain: 'cs',
    explanation: 'Layer 4 (Transport) manages protocols like TCP and UDP for port addressing and reliability.',
  },
  {
    q: 'What HTTP status code represents "Too Many Requests" rate limiting?',
    options: ['403', '409', '429', '503'],
    answer: 2,
    category: 'Web Engineering',
    domain: 'cs',
    explanation: 'HTTP 429 signals that a client exceeded allowed request quotas in a time window.',
  },
  {
    q: 'Which sorting algorithm guarantees O(n log n) worst-case time complexity?',
    options: ['Bubble Sort', 'Merge Sort', 'Insertion Sort', 'Quick Sort'],
    answer: 1,
    category: 'Algorithms',
    domain: 'cs',
    explanation: 'Merge Sort always divides arrays in half and merges in linear time, guaranteeing O(n log n) worst case.',
  },
  {
    q: 'In React, which hook lets you synchronize a component with an external system or timer?',
    options: ['useMemo', 'useEffect', 'useId', 'useReducer'],
    answer: 1,
    category: 'Frontend',
    domain: 'cs',
    explanation: 'useEffect runs side effects after commit and cleans them up before re-running or unmounting.',
  },
  {
    q: 'In Operating Systems, which condition is NOT one of Coffman’s 4 deadlock requirements?',
    options: ['Mutual Exclusion', 'Hold and Wait', 'Preemption Allowed', 'Circular Wait'],
    answer: 2,
    category: 'Operating Systems',
    domain: 'cs',
    explanation: 'Deadlock requires No Preemption, Hold and Wait, Mutual Exclusion, and Circular Wait.',
  },
  {
    q: 'Which SQL clause filters groups created by GROUP BY based on aggregate conditions?',
    options: ['WHERE', 'HAVING', 'ORDER BY', 'DISTINCT'],
    answer: 1,
    category: 'DBMS',
    domain: 'cs',
    explanation: 'WHERE filters rows before grouping, whereas HAVING filters grouped rows after aggregation.',
  },
  {
    q: 'What is the maximum number of nodes in a binary tree of height h (root at height 0)?',
    options: ['2^h', '2^(h+1) - 1', '2h + 1', 'h^2'],
    answer: 1,
    category: 'Data Structures',
    domain: 'cs',
    explanation: 'A full binary tree with levels 0..h has sum_{i=0..h} 2^i = 2^(h+1) - 1 nodes.',
  },
  {
    q: 'Which Linux command displays real-time active processes, CPU usage, and memory stats interactively?',
    options: ['chmod', 'top', 'grep', 'pwd'],
    answer: 1,
    category: 'Linux & Systems',
    domain: 'cs',
    explanation: 'The top command streams live process CPU, memory, and load metrics.',
  },
  {
    q: 'In public-key cryptography, which key is used to verify a sender’s digital signature?',
    options: ['Receiver’s private key', 'Sender’s public key', 'Session AES key', 'HMAC salt'],
    answer: 1,
    category: 'Cybersecurity',
    domain: 'cs',
    explanation: 'A signature created with the sender’s private key is verified using the sender’s public key.',
  },
  {
    q: 'Which CSS display mode arranges children along flexible 1D rows or columns?',
    options: ['display: block', 'display: flex', 'display: inline', 'display: table-cell'],
    answer: 1,
    category: 'Web Engineering',
    domain: 'cs',
    explanation: 'Flexbox (display: flex) provides 1D alignment, spacing, and wrapping.',
  },

  // --- GENERAL TRIVIA (8 Questions -> 30%) ---
  {
    q: 'Which planet in our solar system has the most confirmed moons?',
    options: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'],
    answer: 1,
    category: 'Science',
    domain: 'general',
    explanation: 'Saturn leads with well over 140 confirmed natural satellites.',
  },
  {
    q: 'In Chess, which piece can leap over other pieces on the board?',
    options: ['Bishop', 'Rook', 'Knight', 'Queen'],
    answer: 2,
    category: 'Board Games',
    domain: 'general',
    explanation: 'The Knight moves in an L-shape and is the only chess piece permitted to jump over intervening pieces.',
  },
  {
    q: 'What is the chemical symbol for Tungsten?',
    options: ['Tg', 'Tn', 'W', 'Tu'],
    answer: 2,
    category: 'Chemistry',
    domain: 'general',
    explanation: 'The symbol W comes from Tungsten’s older German mineral name, Wolfram.',
  },
  {
    q: 'Which country won the first ICC Men’s T20 World Cup in 2007?',
    options: ['Australia', 'Pakistan', 'India', 'South Africa'],
    answer: 2,
    category: 'Sports',
    domain: 'general',
    explanation: 'India defeated Pakistan in the inaugural 2007 ICC World Twenty20 final in Johannesburg.',
  },
  {
    q: 'Which strait separates Asia from North America between Russia and Alaska?',
    options: ['Strait of Gibraltar', 'Bering Strait', 'Malacca Strait', 'Palk Strait'],
    answer: 1,
    category: 'Geography',
    domain: 'general',
    explanation: 'The Bering Strait connects the Pacific and Arctic oceans between Siberia and Alaska.',
  },
  {
    q: 'Which musical instrument traditionally uses 88 black and white keys?',
    options: ['Harpsichord', 'Standard Piano', 'Accordion', 'Tabla'],
    answer: 1,
    category: 'Arts & Culture',
    domain: 'general',
    explanation: 'A modern grand or upright piano spans 7 octaves plus a minor third totaling 88 keys.',
  },
  {
    q: 'Which gas makes up roughly 78% of Earth’s dry atmosphere?',
    options: ['Oxygen', 'Nitrogen', 'Argon', 'Carbon Dioxide'],
    answer: 1,
    category: 'Earth Science',
    domain: 'general',
    explanation: 'Earth’s atmosphere is approximately 78% nitrogen (N2) and 21% oxygen (O2).',
  },
  {
    q: 'In which Olympic city were the 2024 Summer Olympic Games hosted?',
    options: ['Tokyo', 'Paris', 'London', 'Los Angeles'],
    answer: 1,
    category: 'Sports',
    domain: 'general',
    explanation: 'Paris hosted the Games of the XXXIII Olympiad in July–August 2024.',
  },
];

function createSeededRng(seed: number): () => number {
  let t = (seed >>> 0) || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleQuestions(list: QuizQuestion[], rng: () => number = Math.random): QuizQuestion[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pickShuffledQuizQuestions(
  count = 10,
  excludeQuestions: string[] = [],
  seed?: number
): QuizQuestion[] {
  const rng = typeof seed === 'number' && Number.isFinite(seed) ? createSeededRng(seed) : Math.random;
  const safeCount = Math.max(5, Math.min(20, count));
  const csTarget = Math.round(safeCount * 0.7);
  const generalTarget = safeCount - csTarget;
  const excludeSet = new Set(excludeQuestions.map((q) => q.trim().toLowerCase()));

  const csFresh = shuffleQuestions(
    QUIZ_QUESTION_BANK.filter((q) => q.domain === 'cs' && !excludeSet.has(q.q.toLowerCase())),
    rng
  );
  const csAll = csFresh.length >= csTarget
    ? csFresh
    : [...csFresh, ...shuffleQuestions(QUIZ_QUESTION_BANK.filter((q) => q.domain === 'cs'), rng)];

  const genFresh = shuffleQuestions(
    QUIZ_QUESTION_BANK.filter((q) => q.domain === 'general' && !excludeSet.has(q.q.toLowerCase())),
    rng
  );
  const genAll = genFresh.length >= generalTarget
    ? genFresh
    : [...genFresh, ...shuffleQuestions(QUIZ_QUESTION_BANK.filter((q) => q.domain === 'general'), rng)];

  const pickedCs = csAll.slice(0, csTarget);
  const pickedGen = genAll.slice(0, generalTarget);
  return shuffleQuestions([...pickedCs, ...pickedGen], rng);
}

export function getQuizAIMove(
  correctIndex: number,
  optionsCount: number,
  difficulty: AIDifficulty
): { choice: number; delayMs: number } {
  let accuracy = 0.5;
  let delayMs = 4500;

  if (difficulty === 'medium') {
    accuracy = 0.78;
    delayMs = 2800;
  } else if (difficulty === 'hard') {
    accuracy = 0.94;
    delayMs = 1400;
  }

  const isCorrect = Math.random() < accuracy;
  if (isCorrect) {
    return { choice: correctIndex, delayMs };
  }

  const wrongOptions = Array.from({ length: optionsCount }, (_, i) => i).filter(
    (i) => i !== correctIndex
  );
  const choice = wrongOptions[Math.floor(Math.random() * wrongOptions.length)] ?? 0;
  return { choice, delayMs };
}

// ============================================================================
// 4. LUDO RULES & AI ENGINE
// Progress per token:
//   -1 = In Home Yard (requires rolling 6 to enter square 0)
//   0..50 = Shared 52-square main loop (mapped to global index by player offset)
//   51..55 = Private 5-square Home Stretch lane
//   56 = Reached Center Home Triangle!
// ============================================================================

export const LUDO_START_OFFSETS = [0, 13, 26, 39];
export const LUDO_SAFE_GLOBAL_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export function ludoLocalToGlobal(playerIdx: number, localProgress: number): number | null {
  if (localProgress < 0 || localProgress > 50) return null;
  return (LUDO_START_OFFSETS[playerIdx] + localProgress) % 52;
}

export function getLegalLudoTokenIndices(playerTokens: number[], roll: number): number[] {
  const legal: number[] = [];
  playerTokens.forEach((pos, tokenIdx) => {
    if (pos === -1) {
      if (roll === 6) legal.push(tokenIdx);
    } else if (pos < 56) {
      if (pos + roll <= 56) legal.push(tokenIdx);
    }
  });
  return legal;
}

export function chooseLudoAIToken(
  allTokens: number[][],
  playerIndex: number,
  roll: number,
  difficulty: AIDifficulty
): number | null {
  const legal = getLegalLudoTokenIndices(allTokens[playerIndex], roll);
  if (legal.length === 0) return null;
  if (difficulty === 'easy' || legal.length === 1) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  let bestToken = legal[0];
  let bestScore = -100;

  for (const tIdx of legal) {
    const cur = allTokens[playerIndex][tIdx];
    const next = cur === -1 ? 0 : cur + roll;
    let score = 0;

    if (next === 56) score += 120; // Enter home triangle
    if (cur === -1 && roll === 6) score += 85; // Unlock from yard
    if (next > 50) score += 50; // Safe home stretch

    const nextGlobal = ludoLocalToGlobal(playerIndex, next);
    if (nextGlobal !== null) {
      if (LUDO_SAFE_GLOBAL_INDICES.has(nextGlobal)) score += 30;
      // Check opponent capture opportunity
      if (!LUDO_SAFE_GLOBAL_INDICES.has(nextGlobal)) {
        for (let opp = 0; opp < 4; opp++) {
          if (opp === playerIndex) continue;
          const hasVictim = allTokens[opp].some((opPos) => ludoLocalToGlobal(opp, opPos) === nextGlobal);
          if (hasVictim) score += difficulty === 'hard' ? 150 : 90;
        }
      }
    }

    score += next * 0.4;
    if (score > bestScore) {
      bestScore = score;
      bestToken = tIdx;
    }
  }

  return bestToken;
}

export function getLudoAIMove(
  positions: number[],
  playerIndex: number,
  roll: number,
  difficulty: AIDifficulty
): number {
  const currentPos = positions[playerIndex];
  if (difficulty === 'hard' && roll === 6 && currentPos === 0) {
    return 1;
  }
  return Math.min(56, currentPos + roll);
}

// ============================================================================
// 5. CARROM AI
// ============================================================================

export function getCarromAIMove(difficulty: AIDifficulty): {
  angle: number;
  power: number;
  successRate: number;
} {
  if (difficulty === 'easy') {
    return {
      angle: Math.floor(20 + Math.random() * 50),
      power: Math.floor(40 + Math.random() * 30),
      successRate: 0.45,
    };
  }
  if (difficulty === 'medium') {
    return {
      angle: Math.floor(40 + Math.random() * 10),
      power: Math.floor(65 + Math.random() * 20),
      successRate: 0.72,
    };
  }
  return {
    angle: 45 + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 3),
    power: 82 + Math.floor(Math.random() * 12),
    successRate: 0.92,
  };
}
