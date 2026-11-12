/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Real-Time Multiplayer Socket & WebRTC Client Service
 * Connects to the full-stack WebSocket server on port 3000,
 * supporting 4-digit room code matchmaking, game state synchronization,
 * live in-game chat, and WebRTC voice/video calling.
 */

import { MultiplayerRoom, InGameChatMessage, InGameCallState } from '../types/multiplayer';

type SocketEventListener = (data: any) => void;

class MultiplayerSocketService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<SocketEventListener>> = new Map();
  private broadcastChannel: BroadcastChannel | null = null;
  private isConnecting = false;
  private reconnectTimer: any = null;
  public isConnected = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('jit_multiplayer_sync_channel');
        this.broadcastChannel.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (type) {
            this.trigger(type, payload);
          }
        };
      } catch (err) {
        console.warn('BroadcastChannel not supported in this browser:', err);
      }
    }
  }

  public connect(): void {
    if (typeof window === 'undefined') return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.trigger('CONNECTION_STATUS', { connected: true });
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, payload } = data;
          if (type) {
            this.trigger(type, payload);
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.socket.onerror = (err) => {
        console.warn('WebSocket connection error, utilizing local/broadcast fallback:', err);
      };

      this.socket.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.trigger('CONNECTION_STATUS', { connected: false });

        // Schedule auto-reconnect
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connect();
        }, 3000);
      };
    } catch (err) {
      this.isConnecting = false;
      this.isConnected = false;
      this.trigger('CONNECTION_STATUS', { connected: false });
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
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      });
    }
  }

  private send(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload });

    // Send over WebSocket if connected
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(message);
    } else {
      // Connect if not already
      this.connect();
    }

    // Mirror via BroadcastChannel for multi-tab testing
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload });
      } catch (err) {
        console.warn('BroadcastChannel error:', err);
      }
    }
  }

  // --------------------------------------------------------------------------
  // API Actions
  // --------------------------------------------------------------------------

  public createRoom(gameId: string, maxPlayers: number, player: { id: string; name: string; avatar: string }): void {
    this.send('CREATE_ROOM', { gameId, maxPlayers, player });
  }

  public joinRoom(roomCode: string, gameId: string, player: { id: string; name: string; avatar: string }): void {
    this.send('JOIN_ROOM', { roomCode, gameId, player });
  }

  public quickMatch(gameId: string, maxPlayers: number, player: { id: string; name: string; avatar: string }): void {
    this.send('QUICK_MATCH', { gameId, maxPlayers, player });
  }

  public startGame(roomCode: string, initialGameState?: any): void {
    this.send('START_GAME', { roomCode, initialGameState });
  }

  public sendMove(roomCode: string, moveAction: string, newGameState: any, nextTurn?: string): void {
    this.send('GAME_MOVE', { roomCode, moveAction, newGameState, nextTurn });
  }

  public rematchGame(roomCode: string, resetState: any): void {
    this.send('REMATCH_GAME', { roomCode, resetState });
  }

  public sendChatMessage(roomCode: string, message: {
    senderId: string;
    senderName: string;
    senderAvatar: string;
    text?: string;
    imageUrl?: string;
  }): void {
    this.send('SEND_CHAT_MESSAGE', { roomCode, message });
  }

  public sendCallSignal(roomCode: string, signalData: any, targetPlayerId?: string, senderId?: string, callType?: 'voice' | 'video'): void {
    this.send('CALL_SIGNAL', { roomCode, signalData, targetPlayerId, senderId, callType });
  }

  public kickPlayer(roomCode: string, targetPlayerId: string): void {
    this.send('KICK_PLAYER', { roomCode, targetPlayerId });
  }

  public leaveRoom(roomCode: string, playerId: string): void {
    this.send('LEAVE_ROOM', { roomCode, playerId });
  }
}

export const multiplayerSocket = new MultiplayerSocketService();
