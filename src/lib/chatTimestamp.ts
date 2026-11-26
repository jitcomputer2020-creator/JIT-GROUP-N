/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TimestampedMessageLike {
  id?: string;
  createdAt?: unknown;
  createdAtMs?: unknown;
  createdAtTs?: unknown;
  createdAtLabel?: unknown;
  timestamp?: unknown;
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
  return 0;
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

  // Match time-only strings like "09:07 AM", "9:07 pm", "14:30", "09:07:15 AM"
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
 * Strict timestamp normalizer used identically when fetching from Firestore
 * and when sorting/rendering unified chat messages in the UI.
 */
export function normalizeTimestamp(msg: TimestampedMessageLike | null | undefined): number {
  if (!msg) return 0;

  // 1. Numeric epoch milliseconds in createdAt
  if (typeof msg.createdAt === 'number' && Number.isFinite(msg.createdAt) && msg.createdAt > 0) {
    return msg.createdAt;
  }

  // 2. Firestore Timestamp on createdAt
  const createdAtMillis = readToMillis(msg.createdAt);
  if (createdAtMillis > 0) return createdAtMillis;

  // 3. Firestore Timestamp on timestamp
  const timestampMillis = readToMillis(msg.timestamp);
  if (timestampMillis > 0) return timestampMillis;

  // 4. Firestore Timestamp on createdAtTs (serverTimestamp field)
  const createdAtTsMillis = readToMillis(msg.createdAtTs);
  if (createdAtTsMillis > 0) return createdAtTsMillis;

  // 5. Numeric createdAtMs or numeric timestamp
  if (typeof msg.createdAtMs === 'number' && Number.isFinite(msg.createdAtMs) && msg.createdAtMs > 0) {
    return msg.createdAtMs;
  }
  if (typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp) && msg.timestamp > 0) {
    return msg.timestamp;
  }

  // 6. Formatted time or date strings (msg.time, msg.createdAt, msg.timestampIso, msg.timestamp, msg.createdAtLabel)
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

  // 7. Embedded numeric epoch in generated message ID (e.g. msg_17326... )
  const idMatch = String(msg.id || '').match(/(\d{12,15})/);
  if (idMatch) {
    const idMs = Number(idMatch[1]);
    if (Number.isFinite(idMs) && idMs > 0) return idMs;
  }

  return 0;
}

export function sortMessagesChronologically<T extends TimestampedMessageLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const diff = normalizeTimestamp(a) - normalizeTimestamp(b);
    if (diff !== 0) return diff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}
