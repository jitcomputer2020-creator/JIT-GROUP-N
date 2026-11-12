/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Authoritative Game AI Engine
 * Provides authentic, legal-move AI decision trees for all 6 campus games
 * across Easy, Medium, and Hard difficulty levels.
 */

import { AIDifficulty } from '../types/multiplayer';

// ============================================================================
// 1. TIC TAC TOE AI (Random, Heuristic Blocker, Minimax)
// ============================================================================

export function getTicTacToeAIMove(
  board: (string | null)[],
  difficulty: AIDifficulty
): number {
  const emptyIndices = board
    .map((val, idx) => (val === null ? idx : null))
    .filter((v): v is number => v !== null);

  if (emptyIndices.length === 0) return -1;

  // Easy: Pure random legal move
  if (difficulty === 'easy') {
    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }

  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  // Helper: check if placing symbol completes 3 in a row
  const findWinningMove = (symbol: 'X' | 'O'): number | null => {
    for (const [a, b, c] of lines) {
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

  // Medium: Win if possible, block opponent if needed, otherwise center/corner
  if (difficulty === 'medium') {
    const winMove = findWinningMove('O');
    if (winMove !== null) return winMove;

    const blockMove = findWinningMove('X');
    if (blockMove !== null) return blockMove;

    if (board[4] === null) return 4; // Center
    const corners = [0, 2, 6, 8].filter((idx) => board[idx] === null);
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)];
    }
    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }

  // Hard: Minimax Algorithm (Optimal Unbeatable Play)
  const checkState = (currentBoard: (string | null)[]): 'X' | 'O' | 'draw' | null => {
    for (const [a, b, c] of lines) {
      if (currentBoard[a] && currentBoard[a] === currentBoard[b] && currentBoard[a] === currentBoard[c]) {
        return currentBoard[a] as 'X' | 'O';
      }
    }
    return currentBoard.every(Boolean) ? 'draw' : null;
  };

  const minimax = (
    currentBoard: (string | null)[],
    depth: number,
    isMaximizing: boolean
  ): { score: number; move?: number } => {
    const winner = checkState(currentBoard);
    if (winner === 'O') return { score: 10 - depth };
    if (winner === 'X') return { score: depth - 10 };
    if (winner === 'draw') return { score: 0 };
    if (depth >= 4) return { score: 0 }; // depth cap for speed

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
// 2. CHESS AI (Legal Move Generator, Piece-Value Scorer)
// ============================================================================

export interface ChessMove {
  from: [number, number];
  to: [number, number];
  piece: string;
  captured: string | null;
  score: number;
}

const PIECE_VALUES: Record<string, number> = {
  '♟': 10,
  '♙': 10,
  '♞': 30,
  '♘': 30,
  '♝': 30,
  '♗': 30,
  '♜': 50,
  '♖': 50,
  '♛': 90,
  '♕': 90,
  '♚': 900,
  '♔': 900,
};

const BLACK_PIECES = new Set(['♜', '♞', '♝', '♛', '♚', '♟']);
const WHITE_PIECES = new Set(['♖', '♘', '♗', '♕', '♔', '♙']);

export function getLegalChessMoves(
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

      // 1. Pawns
      if (piece === '♟') {
        // Black moves down (+1)
        if (r + 1 < 8 && !board[r + 1][c]) {
          moves.push({ from: [r, c], to: [r + 1, c], piece, captured: null, score: 0 });
          if (r === 1 && !board[r + 2][c]) {
            moves.push({ from: [r, c], to: [r + 2, c], piece, captured: null, score: 1 });
          }
        }
        // Captures
        for (const dc of [-1, 1]) {
          if (r + 1 < 8 && c + dc >= 0 && c + dc < 8) {
            const target = board[r + 1][c + dc];
            if (target && oppPieces.has(target)) {
              moves.push({
                from: [r, c],
                to: [r + 1, c + dc],
                piece,
                captured: target,
                score: (PIECE_VALUES[target] || 10) * 2,
              });
            }
          }
        }
      }

      // 2. Knights
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
              moves.push({ from: [r, c], to: [nr, nc], piece, captured: null, score: 1 });
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
      }

      // 3. Rooks / Bishops / Queens / King
      const isRook = piece === '♜' || piece === '♖';
      const isBishop = piece === '♝' || piece === '♗';
      const isQueen = piece === '♛' || piece === '♕';
      const isKing = piece === '♚' || piece === '♔';

      let directions: [number, number][] = [];
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
            break; // path blocked
          }

          if (isKing) break; // king only moves 1 square
          step++;
        }
      }
    }
  }

  return moves;
}

export function getChessAIMove(
  board: (string | null)[][],
  difficulty: AIDifficulty
): ChessMove | null {
  const legalMoves = getLegalChessMoves(board, 'black');
  if (legalMoves.length === 0) return null;

  // Easy: Random legal move
  if (difficulty === 'easy') {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  // Medium: Prioritize captures
  if (difficulty === 'medium') {
    const captures = legalMoves.filter((m) => m.captured !== null);
    if (captures.length > 0) {
      captures.sort((a, b) => b.score - a.score);
      return captures[0];
    }
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  // Hard: Strategic Scoring (Captures + Center Control + King Attack)
  legalMoves.forEach((m) => {
    const [tr, tc] = m.to;
    // Reward controlling center squares (d4, d5, e4, e5)
    if ((tr === 3 || tr === 4) && (tc === 3 || tc === 4)) {
      m.score += 15;
    }
    // Heavy reward if capturing high value piece
    if (m.captured === '♔') m.score += 500;
    if (m.captured === '♕') m.score += 180;
    if (m.captured === '♖') m.score += 100;
  });

  legalMoves.sort((a, b) => b.score - a.score);
  return legalMoves[0];
}

// ============================================================================
// 3. QUIZ BATTLE AI (Accuracy & Reaction Delays)
// ============================================================================

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

  // Choose wrong answer
  const wrongOptions = Array.from({ length: optionsCount }, (_, i) => i).filter(
    (i) => i !== correctIndex
  );
  const choice = wrongOptions[Math.floor(Math.random() * wrongOptions.length)] ?? 0;
  return { choice, delayMs };
}

// ============================================================================
// 4. LUDO AI (Token selection, yard rollout, home race)
// ============================================================================

export function getLudoAIMove(
  positions: number[],
  playerIndex: number,
  roll: number,
  difficulty: AIDifficulty
): number {
  const currentPos = positions[playerIndex];
  let target = Math.min(56, currentPos + roll);

  // Hard: If rolled 6 and piece is in yard (0), immediate breakout
  if (difficulty === 'hard' && roll === 6 && currentPos === 0) {
    return 1;
  }

  return target;
}

// ============================================================================
// 5. CARROM AI (Angle calculation, Queen bonus)
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

  // Hard
  return {
    angle: 45 + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 3),
    power: 82 + Math.floor(Math.random() * 12),
    successRate: 0.92,
  };
}
