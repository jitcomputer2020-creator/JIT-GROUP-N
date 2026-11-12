# JIT GROUP - WebRTC Voice & Video Calling Setup Guide

This document outlines the WebRTC architecture and peer signaling integration for JIT GROUP.

---

## 1. Signaling Architecture (Supabase Realtime)

WebRTC requires signaling to exchange SDP (Session Description Protocol) offers, answers, and ICE (Interactive Connectivity Establishment) candidates between callers.

JIT GROUP uses **Supabase Realtime Channels** (`broadcast` mode) for ultra-low latency signaling:

```typescript
import { createClient } from '@supabase/supabase-js';

const channel = supabase.channel(`call:${callSessionId}`, {
  config: { broadcast: { self: false } },
});

// Broadcast WebRTC Offer
channel.send({
  type: 'broadcast',
  event: 'webrtc-offer',
  payload: { sdp: peerConnection.localDescription },
});

// Listen for Answer and ICE candidates
channel.on('broadcast', { event: 'webrtc-answer' }, ({ payload }) => {
  peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
});

channel.on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
  peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
});
```

---

## 2. STUN & TURN Servers Configuration

To traverse NATs and university/campus firewalls, configure standard free STUN servers and optional production TURN servers (e.g. Metered.ca, Twilio, or Coturn):

```typescript
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Optional Production TURN:
    // {
    //   urls: 'turn:turn.yourdomain.com:3478',
    //   username: 'your-turn-username',
    //   credential: 'your-turn-password',
    // },
  ],
  iceCandidatePoolSize: 10,
};
```

---

## 3. Media Stream Constraints

- **Voice Calls**:
  ```javascript
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  ```
- **Video Calls**:
  ```javascript
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
  });
  ```
