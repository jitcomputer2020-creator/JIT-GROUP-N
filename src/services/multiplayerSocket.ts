/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Real-Time Multiplayer Socket & Broadcast Fallback Service
 * Automatically uses native WebSockets when backed by the Express server (port 3000),
 * and cleanly disables wss:// handshakes on Vercel / static serverless hosts, relying
 * seamlessly on Firebase Firestore real-time listeners (onSnapshot) + BroadcastChannel.
 */

import { detectExpressBackendAvailable, isStaticVercelHost } from '../utils/safeFetch';

type SocketEventListener = (data: any) => void;

class MultiplayerSocketService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<SocketEventListener>> = new Map();
  private broadcastChannel: BroadcastChannel | null = null;
  private isConnecting = false;
  private hasOpenedOnce = false;
  private wsDisabled = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  public isConnected = false;

  constructor() {
    if (typeof window !== 'undefined') {
      if (isStaticVercelHost()) {
        this.wsDisabled = true;
      }
      try {
        this.broadcastChannel = new BroadcastChannel('jit_multiplayer_sync_channel');
        this.broadcastChannel.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (type) {
            this.trigger(type, payload);
          }
        };
      } catch {
        // BroadcastChannel optional fallback
      }
    }
  }

  public connect(): void {
    void this.connectAsync();
  }

  private async connectAsync(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (this.wsDisabled || isStaticVercelHost()) {
      this.wsDisabled = true;
      this.isConnected = false;
      this.isConnecting = false;
      this.trigger('CONNECTION_STATUS', { connected: false, fallback: 'firestore' });
      return;
    }

    if (
      this.isConnecting ||
      (this.socket &&
        (this.socket.readyState === WebSocket.OPEN ||
          this.socket.readyState === WebSocket.CONNECTING))
    ) {
      return;
    }

    this.isConnecting = true;

    try {
      // Probe /api/health content-type before attempting wss:// handshake
      // Prevents 200 OK text/html SPA rewrite errors on Vercel serverless deployments
      const backendAvailable = await detectExpressBackendAvailable();
      if (!backendAvailable) {
        this.wsDisabled = true;
        this.isConnecting = false;
        this.isConnected = false;
        this.trigger('CONNECTION_STATUS', { connected: false, fallback: 'firestore' });
        return;
      }

      if (this.wsDisabled || typeof WebSocket === 'undefined') {
        this.isConnecting = false;
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.hasOpenedOnce = true;
        this.reconnectAttempts = 0;
        this.isConnected = true;
        this.isConnecting = false;
        this.trigger('CONNECTION_STATUS', { connected: true, fallback: 'websocket' });
      };

      this.socket.onmessage = (event) => {
        try {
          if (typeof event.data !== 'string') return;
          const trimmed = event.data.trim();
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return;
          }
          const data = JSON.parse(trimmed);
          const { type, payload } = data || {};
          if (type) {
            this.trigger(type, payload);
          }
        } catch {
          // Ignore non-JSON frames safely
        }
      };

      this.socket.onerror = () => {
        // Suppress console spam; handled gracefully in onclose with Firestore + BroadcastChannel fallback
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.socket = null;
        this.trigger('CONNECTION_STATUS', { connected: false, fallback: 'firestore' });

        // If the WebSocket handshake never succeeded (e.g. serverless / proxy returning HTML 200),
        // permanently disable WS retries for this session and rely on Firestore onSnapshot + BroadcastChannel.
        if (!this.hasOpenedOnce || this.reconnectAttempts >= 3) {
          this.wsDisabled = true;
          return;
        }

        this.reconnectAttempts += 1;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
        }
        const delay = 3000 * this.reconnectAttempts;
        this.reconnectTimer = setTimeout(() => {
          void this.connectAsync();
        }, delay);
      };
    } catch {
      this.wsDisabled = true;
      this.isConnecting = false;
      this.isConnected = false;
      this.trigger('CONNECTION_STATUS', { connected: false, fallback: 'firestore' });
    }
  }

  public on(event: string, listener: SocketEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: SocketEventListener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private trigger(event: string, data: any): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((listener) => {
        try {
          listener(data);
        } catch {
          // Keep individual listener errors isolated
        }
      });
    }
  }

  private send(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload });

    // Send over WebSocket only when connected; avoid triggering wss:// handshakes on serverless deployments
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(message);
      } catch {
        // Fallback continues via Firestore & BroadcastChannel
      }
    } else if (!this.wsDisabled && !this.isConnecting) {
      void this.connectAsync();
    }

    // Mirror via BroadcastChannel for same-browser multi-tab fallback
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload });
      } catch {
        // Ignore BroadcastChannel errors in restricted contexts
      }
    }
  }

  // --------------------------------------------------------------------------
  // API Actions
  // --------------------------------------------------------------------------

  public createRoom(
    gameId: string,
    maxPlayers: number,
    player: { id: string; name: string; avatar: string }
  ): void {
    this.send('CREATE_ROOM', { gameId, maxPlayers, player });
  }

  public joinRoom(
    roomCode: string,
    gameId: string,
    player: { id: string; name: string; avatar: string }
  ): void {
    this.send('JOIN_ROOM', { roomCode, gameId, player });
  }

  public quickMatch(
    gameId: string,
    maxPlayers: number,
    player: { id: string; name: string; avatar: string }
  ): void {
    this.send('QUICK_MATCH', { gameId, maxPlayers, player });
  }

  public startGame(roomCode: string, initialGameState?: any): void {
    this.send('START_GAME', { roomCode, initialGameState });
  }

  public sendMove(
    roomCode: string,
    moveAction: string,
    newGameState: any,
    nextTurn?: string
  ): void {
    this.send('GAME_MOVE', { roomCode, moveAction, newGameState, nextTurn });
  }

  public rematchGame(roomCode: string, resetState: any): void {
    this.send('REMATCH_GAME', { roomCode, resetState });
  }

  public sendChatMessage(
    roomCode: string,
    message: {
      senderId: string;
      senderName: string;
      senderAvatar: string;
      text?: string;
      imageUrl?: string;
    }
  ): void {
    this.send('SEND_CHAT_MESSAGE', { roomCode, message });
  }

  public sendCallSignal(
    roomCode: string,
    signalData: any,
    targetPlayerId?: string,
    senderId?: string,
    callType?: 'voice' | 'video'
  ): void {
    this.send('CALL_SIGNAL', { roomCode, signalData, targetPlayerId, senderId, callType });
  }

  public sendReaction(
    roomCode: string,
    reaction: {
      id: string;
      emoji: string;
      senderId: string;
      senderName: string;
      createdAtMs: number;
    }
  ): void {
    this.send('SEND_REACTION', { roomCode, reaction });
  }

  public hostUpdateModeration(
    roomCode: string,
    mutedVoiceIds: string[],
    mutedChatIds: string[]
  ): void {
    this.send('HOST_SET_MODERATION', { roomCode, mutedVoiceIds, mutedChatIds });
  }

  public hostRotatePlayers(
    roomCode: string,
    nextActiveIds: string[],
    resetState?: any
  ): void {
    this.send('HOST_ROTATE_PLAYERS', { roomCode, nextActiveIds, resetState });
  }

  public kickPlayer(roomCode: string, targetPlayerId: string): void {
    this.send('KICK_PLAYER', { roomCode, targetPlayerId });
  }

  public leaveRoom(roomCode: string, playerId: string): void {
    this.send('LEAVE_ROOM', { roomCode, playerId });
  }
}

export const multiplayerSocket = new MultiplayerSocketService();
