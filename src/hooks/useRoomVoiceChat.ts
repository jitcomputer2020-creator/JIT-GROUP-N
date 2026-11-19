/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-Time WebRTC In-Game Voice Chat Hook with Firebase Firestore Signaling
 * Supports live Mic (Mute/Unmute), Speaker (Audio On/Off), Web Audio API noise reduction
 * (high-pass rumble filter, low-pass hiss trim, speech compressor, gain balance),
 * speaking level detection, and automatic peer-to-peer RTCPeerConnection audio channels.
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

const VOICE_HIGHPASS_HZ = 135;
const OUTGOING_LOWPASS_HZ = 4400;
const INCOMING_LOWPASS_HZ = 4800;

function sanitizePeerId(raw: string): string {
  const cleaned = (raw || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72);
  return cleaned.length >= 3 ? cleaned : `peer_${cleaned || '000'}`;
}

interface RemoteAudioPipeline {
  streamId: string;
  gainNode: GainNode;
  disconnect: () => void;
}

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

  const localPeerId = sanitizePeerId(localPlayer.id);
  const isMicRef = useRef(isMicEnabled);
  const isSpeakerRef = useRef(isSpeakerEnabled);
  const hostMutedVoiceSetRef = useRef<Set<string>>(
    new Set(hostMutedVoiceIds.flatMap((id) => [id, sanitizePeerId(id)]))
  );

  // Raw hardware mic stream vs. Web Audio noise-filtered outgoing stream
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const outgoingProcessedStreamRef = useRef<MediaStream | null>(null);
  const outgoingAudioCleanupRef = useRef<(() => void) | null>(null);

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const remotePipelinesRef = useRef<Map<string, RemoteAudioPipeline>>(new Map());

  const sharedAudioCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const activeRoomRef = useRef<string | undefined>(undefined);
  const isConnectingMicRef = useRef(false);

  useEffect(() => {
    isMicRef.current = isMicEnabled;
  }, [isMicEnabled]);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!sharedAudioCtxRef.current || sharedAudioCtxRef.current.state === 'closed') {
      try {
        sharedAudioCtxRef.current = new AudioCtx();
      } catch {
        return null;
      }
    }

    const ctx = sharedAudioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }, []);

  // Unlock suspended AudioContext cleanly on the next user interaction if needed
  useEffect(() => {
    const resumeCtx = () => {
      const ctx = sharedAudioCtxRef.current;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', resumeCtx, { passive: true });
    window.addEventListener('keydown', resumeCtx, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', resumeCtx);
      window.removeEventListener('keydown', resumeCtx);
    };
  }, []);

  const syncRemoteAudioMuteStates = useCallback(
    (speakerOn: boolean, mutedIds: Set<string>) => {
      const ctx = sharedAudioCtxRef.current;
      if (speakerOn && ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      remotePipelinesRef.current.forEach((pipeline, peerId) => {
        const effectiveMuted = !speakerOn || mutedIds.has(peerId);
        const targetGain = effectiveMuted ? 0 : 0.92;
        try {
          if (ctx && ctx.state === 'running') {
            pipeline.gainNode.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.015);
          } else {
            pipeline.gainNode.gain.value = targetGain;
          }
        } catch {
          pipeline.gainNode.gain.value = targetGain;
        }
      });

      remoteAudioElsRef.current.forEach((audioEl, peerId) => {
        const hasWebAudioPipeline = remotePipelinesRef.current.has(peerId);
        if (hasWebAudioPipeline) {
          // Keep hidden <audio> element muted when Web Audio handles filtered output to prevent double audio/echo
          audioEl.muted = true;
          audioEl.volume = 0;
        } else {
          const effectiveMuted = !speakerOn || mutedIds.has(peerId);
          audioEl.muted = effectiveMuted;
          audioEl.volume = effectiveMuted ? 0 : 0.92;
          if (!effectiveMuted && audioEl.paused && audioEl.srcObject) {
            audioEl.play().catch(() => {});
          }
        }
      });

      remoteStreamsRef.current.forEach((stream, peerId) => {
        const effectiveMuted = !speakerOn || mutedIds.has(peerId);
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !effectiveMuted;
        });
      });
    },
    []
  );

  useEffect(() => {
    isSpeakerRef.current = isSpeakerEnabled;
    const mutedSet = new Set(hostMutedVoiceIds.flatMap((id) => [id, sanitizePeerId(id)]));
    hostMutedVoiceSetRef.current = mutedSet;
    syncRemoteAudioMuteStates(isSpeakerEnabled, mutedSet);
  }, [isSpeakerEnabled, hostMutedVoiceIds, syncRemoteAudioMuteStates]);

  const stopOutgoingAudioProcessing = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (outgoingAudioCleanupRef.current) {
      try {
        outgoingAudioCleanupRef.current();
      } catch {
        // ignore
      }
      outgoingAudioCleanupRef.current = null;
    }
    if (outgoingProcessedStreamRef.current) {
      outgoingProcessedStreamRef.current.getTracks().forEach((t) => t.stop());
      outgoingProcessedStreamRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  /**
   * Routes raw microphone audio through Web Audio API noise-shaping nodes:
   * High-pass (135Hz rumble cut) -> Low-pass (4.4kHz hiss trim) ->
   * Presence peaking (+2dB @ 2.4kHz) -> Compressor -> Output Gain -> MediaStreamDestination.
   * Never connects to ctx.destination so local speakers cannot echo/feedback.
   */
  const createCleanOutgoingMicStream = useCallback(
    (rawStream: MediaStream): MediaStream => {
      stopOutgoingAudioProcessing();
      const ctx = ensureAudioContext();
      if (!ctx || typeof ctx.createMediaStreamDestination !== 'function') {
        outgoingProcessedStreamRef.current = rawStream;
        return rawStream;
      }

      try {
        const source = ctx.createMediaStreamSource(rawStream);

        const highPass = ctx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = VOICE_HIGHPASS_HZ;
        highPass.Q.value = 0.85;

        const lowPass = ctx.createBiquadFilter();
        lowPass.type = 'lowpass';
        lowPass.frequency.value = OUTGOING_LOWPASS_HZ;
        lowPass.Q.value = 0.7;

        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 2400;
        presence.Q.value = 1.0;
        presence.gain.value = 2.0;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 16;
        compressor.ratio.value = 3.2;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.18;

        const outGain = ctx.createGain();
        outGain.gain.value = 1.0;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;

        const destination = ctx.createMediaStreamDestination();

        source.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(presence);
        presence.connect(compressor);
        compressor.connect(outGain);
        outGain.connect(analyser);
        outGain.connect(destination);

        const data = new Uint8Array(analyser.frequencyBinCount);
        meterTimerRef.current = window.setInterval(() => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          setIsSpeaking(avg > 10);
        }, 140);

        outgoingAudioCleanupRef.current = () => {
          try {
            source.disconnect();
            highPass.disconnect();
            lowPass.disconnect();
            presence.disconnect();
            compressor.disconnect();
            outGain.disconnect();
            analyser.disconnect();
            destination.disconnect();
          } catch {
            // ignore disconnect errors
          }
        };

        outgoingProcessedStreamRef.current = destination.stream;
        return destination.stream;
      } catch {
        outgoingProcessedStreamRef.current = rawStream;
        return rawStream;
      }
    },
    [ensureAudioContext, stopOutgoingAudioProcessing]
  );

  const stopLocalMicStream = useCallback(() => {
    stopOutgoingAudioProcessing();
    if (rawMicStreamRef.current) {
      rawMicStreamRef.current.getTracks().forEach((t) => t.stop());
      rawMicStreamRef.current = null;
    }
    peerConnectionsRef.current.forEach((pc) => {
      if (pc.connectionState === 'closed' || pc.signalingState === 'closed') return;
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === 'audio') {
          sender.replaceTrack(null).catch(() => {});
        }
      });
    });
  }, [stopOutgoingAudioProcessing]);

  const teardownRemotePipeline = useCallback((peerId: string) => {
    const existing = remotePipelinesRef.current.get(peerId);
    if (existing) {
      try {
        existing.disconnect();
      } catch {
        // ignore
      }
      remotePipelinesRef.current.delete(peerId);
    }
  }, []);

  /**
   * Routes incoming remote peer stream through Web Audio noise filtering
   * (135Hz high-pass rumble cut, 4.8kHz low-pass hiss trim, dynamics compressor, gain balance)
   * while keeping the Chromium <audio> jitter-buffer anchor strictly muted so there is no overlap/echo.
   */
  const attachRemoteAudioPipeline = useCallback(
    (peerId: string, remoteStream: MediaStream) => {
      const effectiveMuted =
        !isSpeakerRef.current || hostMutedVoiceSetRef.current.has(peerId);

      remoteStreamsRef.current.set(peerId, remoteStream);
      remoteStream.getAudioTracks().forEach((track) => {
        track.enabled = !effectiveMuted;
      });

      let audioEl = remoteAudioElsRef.current.get(peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.setAttribute('playsinline', 'true');
        remoteAudioElsRef.current.set(peerId, audioEl);
      }
      if (audioEl.srcObject !== remoteStream) {
        audioEl.srcObject = remoteStream;
      }

      const existingPipeline = remotePipelinesRef.current.get(peerId);
      if (existingPipeline && existingPipeline.streamId === remoteStream.id) {
        syncRemoteAudioMuteStates(isSpeakerRef.current, hostMutedVoiceSetRef.current);
        return;
      }

      teardownRemotePipeline(peerId);

      const ctx = ensureAudioContext();
      if (ctx) {
        try {
          const source = ctx.createMediaStreamSource(remoteStream);

          const highPass = ctx.createBiquadFilter();
          highPass.type = 'highpass';
          highPass.frequency.value = VOICE_HIGHPASS_HZ;
          highPass.Q.value = 0.85;

          const lowPass = ctx.createBiquadFilter();
          lowPass.type = 'lowpass';
          lowPass.frequency.value = INCOMING_LOWPASS_HZ;
          lowPass.Q.value = 0.7;

          const compressor = ctx.createDynamicsCompressor();
          compressor.threshold.value = -22;
          compressor.knee.value = 15;
          compressor.ratio.value = 3.0;
          compressor.attack.value = 0.005;
          compressor.release.value = 0.2;

          const gainNode = ctx.createGain();
          gainNode.gain.value = effectiveMuted ? 0 : 0.92;

          source.connect(highPass);
          highPass.connect(lowPass);
          lowPass.connect(compressor);
          compressor.connect(gainNode);
          gainNode.connect(ctx.destination);

          remotePipelinesRef.current.set(peerId, {
            streamId: remoteStream.id,
            gainNode,
            disconnect: () => {
              source.disconnect();
              highPass.disconnect();
              lowPass.disconnect();
              compressor.disconnect();
              gainNode.disconnect();
            },
          });

          // Mute the DOM <audio> element (keeps WebRTC stream pumping in Chrome without double audio)
          audioEl.muted = true;
          audioEl.volume = 0;
          audioEl.play().catch(() => {});
          setConnectedAudioCount(remoteAudioElsRef.current.size);
          return;
        } catch {
          teardownRemotePipeline(peerId);
        }
      }

      // Clean fallback if Web Audio API is unavailable
      audioEl.muted = effectiveMuted;
      audioEl.volume = effectiveMuted ? 0 : 0.92;
      audioEl.play().catch(() => {});
      setConnectedAudioCount(remoteAudioElsRef.current.size);
    },
    [ensureAudioContext, syncRemoteAudioMuteStates, teardownRemotePipeline]
  );

  const closePeerConnection = useCallback(
    (peerId: string) => {
      teardownRemotePipeline(peerId);
      remoteStreamsRef.current.delete(peerId);

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
    },
    [teardownRemotePipeline]
  );

  const cleanupAllPeers = useCallback(() => {
    Array.from(peerConnectionsRef.current.keys()).forEach((id) => {
      closePeerConnection(id);
    });
    setConnectedAudioCount(0);
  }, [closePeerConnection]);

  const getOrCreatePeerConnection = useCallback(
    (targetPeerId: string, currentRoomCode: string): RTCPeerConnection | null => {
      if (typeof RTCPeerConnection === 'undefined') return null;

      const normalizedTargetId = sanitizePeerId(targetPeerId);
      const existing = peerConnectionsRef.current.get(normalizedTargetId);
      if (existing && existing.signalingState !== 'closed') {
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      const outgoingStream = outgoingProcessedStreamRef.current || rawMicStreamRef.current;
      if (outgoingStream && outgoingStream.getAudioTracks().length > 0) {
        outgoingStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, outgoingStream);
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
            fromId: localPeerId,
            toId: normalizedTargetId,
            signalType: 'candidate',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid ?? undefined,
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
          }).catch(() => {});
        }
      };

      pc.ontrack = (event) => {
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        attachRemoteAudioPipeline(normalizedTargetId, remoteStream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          closePeerConnection(normalizedTargetId);
        }
      };

      peerConnectionsRef.current.set(normalizedTargetId, pc);
      return pc;
    },
    [attachRemoteAudioPipeline, closePeerConnection, localPeerId]
  );

  const sendOfferToPeer = useCallback(
    async (targetPeerId: string, currentRoomCode: string) => {
      const pc = getOrCreatePeerConnection(targetPeerId, currentRoomCode);
      if (!pc || pc.signalingState !== 'stable') return;
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        if (offer.sdp) {
          await sendFirestoreVoiceSignal(currentRoomCode, {
            fromId: localPeerId,
            toId: sanitizePeerId(targetPeerId),
            signalType: 'offer',
            sdp: offer.sdp,
          });
        }
      } catch {
        // Non-fatal negotiation retry handled on next signal
      }
    },
    [getOrCreatePeerConnection, localPeerId]
  );

  // Sync Firestore voice_peers & voice_signals for any active room (4-digit private, Quick Match, or Open Group)
  useEffect(() => {
    const cleanRoomCode = roomCode?.trim() || '';
    const validRoom = Boolean(
      enabled && cleanRoomCode.length > 0 && !cleanRoomCode.startsWith('ai_')
    );
    if (!validRoom) {
      activeRoomRef.current = undefined;
      setVoicePeers([]);
      cleanupAllPeers();
      return;
    }

    activeRoomRef.current = cleanRoomCode;

    // Publish local voice presence
    upsertFirestoreVoicePeer(cleanRoomCode, {
      peerId: localPeerId,
      name: localPlayer.name,
      avatar: localPlayer.avatar,
      micEnabled: isMicRef.current,
    }).catch(() => {});

    const unsubPeers = subscribeToFirestoreVoicePeers(cleanRoomCode, (peers) => {
      setVoicePeers(peers);

      const remoteIds = new Set(
        peers.filter((p) => sanitizePeerId(p.peerId) !== localPeerId).map((p) => sanitizePeerId(p.peerId))
      );

      // Clean up departed peers
      Array.from(peerConnectionsRef.current.keys()).forEach((existingId) => {
        if (!remoteIds.has(existingId)) {
          closePeerConnection(existingId);
        }
      });

      // Deterministic offer initiator (lexicographically smaller peerId initiates)
      remoteIds.forEach((remoteId) => {
        if (!peerConnectionsRef.current.has(remoteId) && localPeerId < remoteId) {
          sendOfferToPeer(remoteId, cleanRoomCode);
        }
      });
    });

    const unsubSignals = subscribeToFirestoreVoiceSignals(
      cleanRoomCode,
      localPeerId,
      async (sig: FirestoreVoiceSignal) => {
        const fromPeerId = sanitizePeerId(sig.fromId || '');
        if (!fromPeerId || fromPeerId === localPeerId) return;

        if (sig.signalType === 'hangup') {
          closePeerConnection(fromPeerId);
          return;
        }

        const pc = getOrCreatePeerConnection(fromPeerId, cleanRoomCode);
        if (!pc) return;

        try {
          if (sig.signalType === 'offer' && sig.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sig.sdp }));
            const buffered = pendingIceRef.current.get(fromPeerId) || [];
            for (const c of buffered) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pendingIceRef.current.delete(fromPeerId);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (answer.sdp) {
              await sendFirestoreVoiceSignal(cleanRoomCode, {
                fromId: localPeerId,
                toId: fromPeerId,
                signalType: 'answer',
                sdp: answer.sdp,
              });
            }
          } else if (sig.signalType === 'answer' && sig.sdp) {
            if (pc.signalingState !== 'stable') {
              await pc.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: sig.sdp })
              );
              const buffered = pendingIceRef.current.get(fromPeerId) || [];
              for (const c of buffered) {
                await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
              }
              pendingIceRef.current.delete(fromPeerId);
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
              const queue = pendingIceRef.current.get(fromPeerId) || [];
              queue.push(iceInit);
              pendingIceRef.current.set(fromPeerId, queue);
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
      removeFirestoreVoicePeer(cleanRoomCode, localPeerId).catch(() => {});
      cleanupAllPeers();
    };
  }, [
    cleanupAllPeers,
    closePeerConnection,
    enabled,
    getOrCreatePeerConnection,
    localPeerId,
    localPlayer.avatar,
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
        peerId: localPeerId,
        name: localPlayer.name,
        avatar: localPlayer.avatar,
        micEnabled: false,
      }).catch(() => {});
    }
  }, [isHostMutedMic, localPeerId, localPlayer.avatar, localPlayer.name, stopLocalMicStream]);

  // Cleanup local media and shared AudioContext on unmount
  useEffect(() => {
    return () => {
      stopLocalMicStream();
      cleanupAllPeers();
      if (sharedAudioCtxRef.current && sharedAudioCtxRef.current.state !== 'closed') {
        sharedAudioCtxRef.current.close().catch(() => {});
        sharedAudioCtxRef.current = null;
      }
    };
  }, [cleanupAllPeers, stopLocalMicStream]);

  const toggleMic = useCallback(async () => {
    setVoiceError(null);
    ensureAudioContext();

    if (isHostMutedMic) {
      setIsMicEnabled(false);
      setVoiceError('Your microphone was muted by the Room Host.');
      return;
    }

    if (isConnectingMicRef.current) return;

    if (isMicRef.current) {
      // Turn Mic OFF cleanly
      stopLocalMicStream();
      setIsMicEnabled(false);
      if (activeRoomRef.current) {
        upsertFirestoreVoicePeer(activeRoomRef.current, {
          peerId: localPeerId,
          name: localPlayer.name,
          avatar: localPlayer.avatar,
          micEnabled: false,
        }).catch(() => {});
      }
      return;
    }

    // Turn Mic ON with hardware DSP + Web Audio voice shaping
    isConnectingMicRef.current = true;
    setIsConnectingMic(true);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone audio is not supported by this browser.');
      }
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      rawMicStreamRef.current = rawStream;
      const cleanStream = createCleanOutgoingMicStream(rawStream);
      setIsMicEnabled(true);

      const audioTrack =
        cleanStream.getAudioTracks()[0] || rawStream.getAudioTracks()[0];
      const currentRoom = activeRoomRef.current;

      if (audioTrack) {
        peerConnectionsRef.current.forEach((pc, remoteId) => {
          if (pc.connectionState === 'closed' || pc.signalingState === 'closed') return;
          const existingAudioSender = pc
            .getSenders()
            .find((s) => s.track?.kind === 'audio' || !s.track);
          if (existingAudioSender) {
            existingAudioSender.replaceTrack(audioTrack).catch(() => {});
            const matchingTransceiver = pc
              .getTransceivers()
              .find((t) => t.sender === existingAudioSender);
            if (
              matchingTransceiver &&
              matchingTransceiver.currentDirection !== 'sendrecv' &&
              matchingTransceiver.currentDirection !== 'sendonly'
            ) {
              try {
                matchingTransceiver.direction = 'sendrecv';
              } catch {
                // ignore read-only direction in older browsers
              }
              if (currentRoom && pc.signalingState === 'stable') {
                sendOfferToPeer(remoteId, currentRoom).catch(() => {});
              }
            }
          } else {
            pc.addTrack(audioTrack, cleanStream);
            if (currentRoom && pc.signalingState === 'stable') {
              sendOfferToPeer(remoteId, currentRoom).catch(() => {});
            }
          }
        });
      }

      if (currentRoom) {
        upsertFirestoreVoicePeer(currentRoom, {
          peerId: localPeerId,
          name: localPlayer.name,
          avatar: localPlayer.avatar,
          micEnabled: true,
        }).catch(() => {});
      }
    } catch (err: any) {
      stopLocalMicStream();
      setIsMicEnabled(false);
      setVoiceError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission denied. Allow mic access in browser settings to talk.'
          : err?.message || 'Unable to access microphone hardware.'
      );
    } finally {
      isConnectingMicRef.current = false;
      setIsConnectingMic(false);
    }
  }, [
    createCleanOutgoingMicStream,
    ensureAudioContext,
    isHostMutedMic,
    localPeerId,
    localPlayer.avatar,
    localPlayer.name,
    sendOfferToPeer,
    stopLocalMicStream,
  ]);

  const toggleSpeaker = useCallback(() => {
    ensureAudioContext();
    setIsSpeakerEnabled((prev) => {
      const next = !prev;
      isSpeakerRef.current = next;
      syncRemoteAudioMuteStates(next, hostMutedVoiceSetRef.current);
      return next;
    });
  }, [ensureAudioContext, syncRemoteAudioMuteStates]);

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
