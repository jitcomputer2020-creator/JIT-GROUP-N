/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-Time WebRTC In-Game Voice Chat Hook with Firebase Firestore Signaling
 * Supports live Mic (Mute/Unmute), Speaker (Audio On/Off), speaking level detection,
 * and automatic peer-to-peer RTCPeerConnection audio channels synced via Firestore.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  upsertFirestoreVoicePeer,
  removeFirestoreVoicePeer,
  subscribeToFirestoreVoicePeers,
  sendFirestoreVoiceSignal,
  subscribeToFirestoreVoiceSignals,
  FirestoreVoicePeer,
  FirestoreVoiceSignal,
} from '../lib/firebase';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface UseRoomVoiceChatOptions {
  roomCode?: string;
  localPlayer: { id: string; name: string; avatar: string };
  enabled?: boolean;
  isHostMutedMic?: boolean;
  hostMutedVoiceIds?: string[];
}

export interface RoomVoiceChatState {
  isMicEnabled: boolean;
  isSpeakerEnabled: boolean;
  isConnectingMic: boolean;
  isSpeaking: boolean;
  isHostMutedMic: boolean;
  voiceError: string | null;
  voicePeers: FirestoreVoicePeer[];
  connectedAudioCount: number;
  toggleMic: () => Promise<void>;
  toggleSpeaker: () => void;
  clearVoiceError: () => void;
}

export function useRoomVoiceChat({
  roomCode,
  localPlayer,
  enabled = true,
  isHostMutedMic = false,
  hostMutedVoiceIds = [],
}: UseRoomVoiceChatOptions): RoomVoiceChatState {
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [isConnectingMic, setIsConnectingMic] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voicePeers, setVoicePeers] = useState<FirestoreVoicePeer[]>([]);
  const [connectedAudioCount, setConnectedAudioCount] = useState(0);

  const isMicRef = useRef(isMicEnabled);
  const isSpeakerRef = useRef(isSpeakerEnabled);
  const hostMutedVoiceSetRef = useRef<Set<string>>(new Set(hostMutedVoiceIds));
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const activeRoomRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    isMicRef.current = isMicEnabled;
  }, [isMicEnabled]);

  useEffect(() => {
    isSpeakerRef.current = isSpeakerEnabled;
    const mutedSet = new Set(hostMutedVoiceIds);
    hostMutedVoiceSetRef.current = mutedSet;
    remoteAudioElsRef.current.forEach((audioEl, peerId) => {
      const effectiveMuted = !isSpeakerEnabled || mutedSet.has(peerId);
      audioEl.muted = effectiveMuted;
      audioEl.volume = effectiveMuted ? 0 : 1;
      if (!effectiveMuted && audioEl.paused && audioEl.srcObject) {
        audioEl.play().catch(() => {});
      }
    });
  }, [isSpeakerEnabled, hostMutedVoiceIds]);

  const stopSpeakingMeter = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const startSpeakingMeter = useCallback(
    (stream: MediaStream) => {
      stopSpeakingMeter();
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        const src = ctx.createMediaStreamSource(stream);
        src.connect(analyser);
        audioCtxRef.current = ctx;

        const data = new Uint8Array(analyser.frequencyBinCount);
        meterTimerRef.current = window.setInterval(() => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          setIsSpeaking(avg > 12);
        }, 140);
      } catch {
        // Non-fatal in environments without Web Audio
      }
    },
    [stopSpeakingMeter]
  );

  const stopLocalMicStream = useCallback(() => {
    stopSpeakingMeter();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    peerConnectionsRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === 'audio') {
          sender.replaceTrack(null).catch(() => {});
        }
      });
    });
  }, [stopSpeakingMeter]);

  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        // ignore
      }
      peerConnectionsRef.current.delete(peerId);
    }
    pendingIceRef.current.delete(peerId);
    const audioEl = remoteAudioElsRef.current.get(peerId);
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
      } catch {
        // ignore
      }
      remoteAudioElsRef.current.delete(peerId);
    }
    setConnectedAudioCount(remoteAudioElsRef.current.size);
  }, []);

  const cleanupAllPeers = useCallback(() => {
    Array.from(peerConnectionsRef.current.keys()).forEach((id) => {
      closePeerConnection(id);
    });
    setConnectedAudioCount(0);
  }, [closePeerConnection]);

  const getOrCreatePeerConnection = useCallback(
    (targetPeerId: string, currentRoomCode: string): RTCPeerConnection | null => {
      if (typeof RTCPeerConnection === 'undefined') return null;

      const existing = peerConnectionsRef.current.get(targetPeerId);
      if (existing && existing.signalingState !== 'closed') {
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // Ensure an audio transceiver exists to receive opponent voice even if our mic is muted
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      } else {
        try {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        } catch {
          // fallback if browser disallows explicit transceiver before offer
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendFirestoreVoiceSignal(currentRoomCode, {
            fromId: localPlayer.id,
            toId: targetPeerId,
            signalType: 'candidate',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid ?? undefined,
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
          }).catch(() => {});
        }
      };

      pc.ontrack = (event) => {
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        let audioEl = remoteAudioElsRef.current.get(targetPeerId);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.setAttribute('playsinline', 'true');
          remoteAudioElsRef.current.set(targetPeerId, audioEl);
        }
        audioEl.srcObject = remoteStream;
        const effectiveMuted = !isSpeakerRef.current || hostMutedVoiceSetRef.current.has(targetPeerId);
        audioEl.muted = effectiveMuted;
        audioEl.volume = effectiveMuted ? 0 : 1;
        audioEl.play().catch(() => {});
        setConnectedAudioCount(remoteAudioElsRef.current.size);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          closePeerConnection(targetPeerId);
        }
      };

      peerConnectionsRef.current.set(targetPeerId, pc);
      return pc;
    },
    [closePeerConnection, localPlayer.id]
  );

  const sendOfferToPeer = useCallback(
    async (targetPeerId: string, currentRoomCode: string) => {
      const pc = getOrCreatePeerConnection(targetPeerId, currentRoomCode);
      if (!pc) return;
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        if (offer.sdp) {
          await sendFirestoreVoiceSignal(currentRoomCode, {
            fromId: localPlayer.id,
            toId: targetPeerId,
            signalType: 'offer',
            sdp: offer.sdp,
          });
        }
      } catch {
        // Non-fatal negotiation retry handled on next signal
      }
    },
    [getOrCreatePeerConnection, localPlayer.id]
  );

  // Sync Firestore voice_peers & voice_signals when inside a 4-digit room
  useEffect(() => {
    const validRoom = Boolean(enabled && roomCode && /^\d{4}$/.test(roomCode));
    if (!validRoom || !roomCode) {
      activeRoomRef.current = undefined;
      setVoicePeers([]);
      cleanupAllPeers();
      return;
    }

    activeRoomRef.current = roomCode;

    // Publish local voice presence
    upsertFirestoreVoicePeer(roomCode, {
      peerId: localPlayer.id,
      name: localPlayer.name,
      avatar: localPlayer.avatar,
      micEnabled: isMicRef.current,
    }).catch(() => {});

    const unsubPeers = subscribeToFirestoreVoicePeers(roomCode, (peers) => {
      setVoicePeers(peers);

      const remoteIds = new Set(
        peers.filter((p) => p.peerId !== localPlayer.id).map((p) => p.peerId)
      );

      // Clean up departed peers
      Array.from(peerConnectionsRef.current.keys()).forEach((existingId) => {
        if (!remoteIds.has(existingId)) {
          closePeerConnection(existingId);
        }
      });

      // Deterministic offer initiator (lexicographically smaller peerId initiates)
      remoteIds.forEach((remoteId) => {
        if (!peerConnectionsRef.current.has(remoteId) && localPlayer.id < remoteId) {
          sendOfferToPeer(remoteId, roomCode);
        }
      });
    });

    const unsubSignals = subscribeToFirestoreVoiceSignals(
      roomCode,
      localPlayer.id,
      async (sig: FirestoreVoiceSignal) => {
        if (!sig.fromId || sig.fromId === localPlayer.id) return;

        if (sig.signalType === 'hangup') {
          closePeerConnection(sig.fromId);
          return;
        }

        const pc = getOrCreatePeerConnection(sig.fromId, roomCode);
        if (!pc) return;

        try {
          if (sig.signalType === 'offer' && sig.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sig.sdp }));
            const buffered = pendingIceRef.current.get(sig.fromId) || [];
            for (const c of buffered) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pendingIceRef.current.delete(sig.fromId);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (answer.sdp) {
              await sendFirestoreVoiceSignal(roomCode, {
                fromId: localPlayer.id,
                toId: sig.fromId,
                signalType: 'answer',
                sdp: answer.sdp,
              });
            }
          } else if (sig.signalType === 'answer' && sig.sdp) {
            if (pc.signalingState !== 'stable') {
              await pc.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: sig.sdp })
              );
              const buffered = pendingIceRef.current.get(sig.fromId) || [];
              for (const c of buffered) {
                await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              }
              pendingIceRef.current.delete(sig.fromId);
            }
          } else if (sig.signalType === 'candidate' && sig.candidate) {
            const iceInit: RTCIceCandidateInit = {
              candidate: sig.candidate,
              sdpMid: sig.sdpMid ?? null,
              sdpMLineIndex: sig.sdpMLineIndex ?? null,
            };
            if (pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(iceInit)).catch(() => {});
            } else {
              const queue = pendingIceRef.current.get(sig.fromId) || [];
              queue.push(iceInit);
              pendingIceRef.current.set(sig.fromId, queue);
            }
          }
        } catch {
          // Non-fatal WebRTC signaling race ignored cleanly
        }
      }
    );

    return () => {
      unsubPeers();
      unsubSignals();
      removeFirestoreVoicePeer(roomCode, localPlayer.id).catch(() => {});
      cleanupAllPeers();
    };
  }, [
    cleanupAllPeers,
    closePeerConnection,
    enabled,
    getOrCreatePeerConnection,
    localPlayer.avatar,
    localPlayer.id,
    localPlayer.name,
    roomCode,
    sendOfferToPeer,
  ]);

  // Enforce immediate mic shutdown when Host mutes this participant
  useEffect(() => {
    if (!isHostMutedMic) return;
    stopLocalMicStream();
    setIsMicEnabled(false);
    setIsConnectingMic(false);
    if (activeRoomRef.current) {
      upsertFirestoreVoicePeer(activeRoomRef.current, {
        peerId: localPlayer.id,
        name: localPlayer.name,
        avatar: localPlayer.avatar,
        micEnabled: false,
      }).catch(() => {});
    }
  }, [isHostMutedMic, localPlayer.avatar, localPlayer.id, localPlayer.name, stopLocalMicStream]);

  // Cleanup local media on unmount
  useEffect(() => {
    return () => {
      stopLocalMicStream();
      cleanupAllPeers();
    };
  }, [cleanupAllPeers, stopLocalMicStream]);

  const toggleMic = useCallback(async () => {
    setVoiceError(null);

    if (isHostMutedMic) {
      setIsMicEnabled(false);
      setVoiceError('Your microphone was muted by the Room Host.');
      return;
    }

    if (isMicRef.current) {
      // Turn Mic OFF
      stopLocalMicStream();
      setIsMicEnabled(false);
      if (activeRoomRef.current) {
        upsertFirestoreVoicePeer(activeRoomRef.current, {
          peerId: localPlayer.id,
          name: localPlayer.name,
          avatar: localPlayer.avatar,
          micEnabled: false,
        }).catch(() => {});
      }
      return;
    }

    // Turn Mic ON
    setIsConnectingMic(true);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone audio is not supported by this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;
      startSpeakingMeter(stream);
      setIsMicEnabled(true);

      const audioTrack = stream.getAudioTracks()[0];
      const currentRoom = activeRoomRef.current;

      if (audioTrack) {
        peerConnectionsRef.current.forEach((pc, remoteId) => {
          const existingAudioSender = pc
            .getSenders()
            .find((s) => s.track?.kind === 'audio' || !s.track);
          if (existingAudioSender) {
            existingAudioSender.replaceTrack(audioTrack).catch(() => {});
          } else {
            pc.addTrack(audioTrack, stream);
          }
          if (currentRoom) {
            sendOfferToPeer(remoteId, currentRoom).catch(() => {});
          }
        });
      }

      if (currentRoom) {
        upsertFirestoreVoicePeer(currentRoom, {
          peerId: localPlayer.id,
          name: localPlayer.name,
          avatar: localPlayer.avatar,
          micEnabled: true,
        }).catch(() => {});
      }
    } catch (err: any) {
      setIsMicEnabled(false);
      setVoiceError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow mic access in browser settings to talk.'
          : err?.message || 'Unable to access microphone hardware.'
      );
    } finally {
      setIsConnectingMic(false);
    }
  }, [
    isHostMutedMic,
    localPlayer.avatar,
    localPlayer.id,
    localPlayer.name,
    sendOfferToPeer,
    startSpeakingMeter,
    stopLocalMicStream,
  ]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeakerEnabled((prev) => !prev);
  }, []);

  const clearVoiceError = useCallback(() => {
    setVoiceError(null);
  }, []);

  return {
    isMicEnabled,
    isSpeakerEnabled,
    isConnectingMic,
    isSpeaking,
    isHostMutedMic,
    voiceError,
    voicePeers,
    connectedAudioCount,
    toggleMic,
    toggleSpeaker,
    clearVoiceError,
  };
}
