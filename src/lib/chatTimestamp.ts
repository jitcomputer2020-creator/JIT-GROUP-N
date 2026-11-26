/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TimestampedMessageLike {
  id?: string;
  timestamp?: unknown;
  clientCreatedAt?: unknown;
  createdAtTs?: unknown;
  createdAt?: unknown;
  createdAtMs?: unknown;
  createdAtLabel?: unknown;
  timestampIso?: unknown;
  time?: unknown;
  date?: unknown;
}

function readToMillis(val: unknown): number {
  if (val && typeof (val as { toMillis?: unknown }).toMillis === 'function') {
    try {
      const ms = (val as { toMillis: () => number }).toMillis();
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        return ms;
      }
    } catch {
      return 0;
    }
  }
  if (val && typeof (val as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      const ms = d?.getTime?.();
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        return ms;
      }
    } catch {
      return 0;
    }
  }
  return 0;
}

function readToDate(val: unknown): Date | null {
  if (val && typeof (val as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        return d;
      }
    } catch {
      return null;
    }
  }
  const ms = readToMillis(val);
  if (ms > 0) return new Date(ms);
  return null;
}

function resolveBaseDate(dateHint: unknown): Date {
  const hintMs = readToMillis(dateHint);
  if (hintMs > 0) return new Date(hintMs);

  if (typeof dateHint === 'number' && Number.isFinite(dateHint) && dateHint > 0) {
    return new Date(dateHint);
  }
  if (typeof dateHint === 'string' && dateHint.trim()) {
    const parsed = Date.parse(dateHint.trim());
    if (!Number.isNaN(parsed) && parsed > 0) {
      return new Date(parsed);
    }
  }
  return new Date();
}

function parseTimeOrDateString(raw: unknown, dateHint?: unknown): number {
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  if (/^\d{10,}$/.test(trimmed)) {
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
  }

  const timeOnlyMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (timeOnlyMatch) {
    const base = resolveBaseDate(dateHint);
    const formattedForParse = `${base.toDateString()} ${timeOnlyMatch[1]}:${timeOnlyMatch[2]}${
      timeOnlyMatch[3] ? `:${timeOnlyMatch[3]}` : ''
    }${timeOnlyMatch[4] ? ` ${timeOnlyMatch[4].toUpperCase()}` : ''}`;

    const parsedCombined = Date.parse(formattedForParse);
    if (!Number.isNaN(parsedCombined) && parsedCombined > 0) {
      return parsedCombined;
    }

    let hours = Number(timeOnlyMatch[1]);
    const minutes = Number(timeOnlyMatch[2]);
    const seconds = Number(timeOnlyMatch[3] || 0);
    const meridiem = timeOnlyMatch[4]?.toUpperCase();

    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
      const localDate = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hours,
        minutes,
        seconds,
        0
      );
      const ms = localDate.getTime();
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return 0;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }

  return 0;
}

/**
 * Authoritative server-timestamp-first normalizer:
 * 1. Resolved Firestore server Timestamp (`timestamp.toMillis()` / `createdAtTs.toMillis()`)
 * 2. Local `clientCreatedAt` ONLY while server timestamp is pending (`hasPendingWrites`)
 * 3. Legacy numeric/string timestamp fallbacks
 */
export function normalizeTimestamp(msg: TimestampedMessageLike | null | undefined): number {
  if (!msg) return 0;

  // 1. Authoritative Firestore serverTimestamp() on `timestamp`
  const serverTimestampMs = readToMillis(msg.timestamp);
  if (serverTimestampMs > 0) return serverTimestampMs;

  // 2. Authoritative Firestore serverTimestamp() on `createdAtTs`
  const createdAtTsMs = readToMillis(msg.createdAtTs);
  if (createdAtTsMs > 0) return createdAtTsMs;

  // 3. Firestore Timestamp on `createdAt`
  const createdAtTimestampMs = readToMillis(msg.createdAt);
  if (createdAtTimestampMs > 0) return createdAtTimestampMs;

  // 4. Local fallback `clientCreatedAt` while serverTimestamp() is pending
  if (typeof msg.clientCreatedAt === 'number' && Number.isFinite(msg.clientCreatedAt) && msg.clientCreatedAt > 0) {
    return msg.clientCreatedAt;
  }

  // 5. Legacy numeric fields
  if (typeof msg.createdAt === 'number' && Number.isFinite(msg.createdAt) && msg.createdAt > 0) {
    return msg.createdAt;
  }
  if (typeof msg.createdAtMs === 'number' && Number.isFinite(msg.createdAtMs) && msg.createdAtMs > 0) {
    return msg.createdAtMs;
  }
  if (typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp) && msg.timestamp > 0) {
    return msg.timestamp;
  }

  // 6. Legacy formatted date/time strings
  const dateHint = msg.date ?? msg.timestampIso ?? msg.createdAtTs;
  const fromTime = parseTimeOrDateString(msg.time, dateHint);
  if (fromTime > 0) return fromTime;

  const fromCreatedStr = parseTimeOrDateString(msg.createdAt, dateHint);
  if (fromCreatedStr > 0) return fromCreatedStr;

  const fromTimestampIso = parseTimeOrDateString(msg.timestampIso, dateHint);
  if (fromTimestampIso > 0) return fromTimestampIso;

  const fromTimestampStr = parseTimeOrDateString(msg.timestamp, dateHint);
  if (fromTimestampStr > 0) return fromTimestampStr;

  const fromLabel = parseTimeOrDateString(msg.createdAtLabel, dateHint);
  if (fromLabel > 0) return fromLabel;

  // 7. Embedded numeric epoch in generated message ID
  const idMatch = String(msg.id || '').match(/(\d{12,15})/);
  if (idMatch) {
    const idMs = Number(idMatch[1]);
    if (Number.isFinite(idMs) && idMs > 0) return idMs;
  }

  return 0;
}

/**
 * Formats display time from the resolved Firestore server timestamp `timestamp.toDate()`
 * so both users see the exact same server time, falling back to `clientCreatedAt` only
 * while the server timestamp is still pending.
 */
export function resolveServerTimeLabel(msg: TimestampedMessageLike | null | undefined): string {
  if (!msg) return 'Now';

  const serverDate =
    readToDate(msg.timestamp) ||
    readToDate(msg.createdAtTs) ||
    readToDate(msg.createdAt);
  if (serverDate) {
    return serverDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (typeof msg.clientCreatedAt === 'number' && Number.isFinite(msg.clientCreatedAt) && msg.clientCreatedAt > 0) {
    return new Date(msg.clientCreatedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const ms = normalizeTimestamp(msg);
  if (ms > 0) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (typeof msg.time === 'string' && msg.time.trim()) {
    return msg.time;
  }
  if (typeof msg.createdAtLabel === 'string' && msg.createdAtLabel.trim()) {
    return msg.createdAtLabel;
  }
  return 'Now';
}

export function sortMessagesChronologically<T extends TimestampedMessageLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aMs = normalizeTimestamp(a);
    const bMs = normalizeTimestamp(b);
    if (aMs !== bMs) return aMs - bMs;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}
