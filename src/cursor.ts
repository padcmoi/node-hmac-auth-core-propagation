import type { PropagationRedisClient, PropagationTrack } from "./types.js";

// Per (track, clientId) monotonic cursor. Drop any event whose ts is not strictly greater
// than the last seen one, or whose ts equals it but whose eventId is lexicographically
// less than or equal. Kept in Redis without TTL: cursors survive long backlog drains.

const KEY_PREFIX = "propagation:last-seen";

function cursorKey(track: PropagationTrack, clientId: string) {
  return `${KEY_PREFIX}:${track}:${clientId}`;
}

export interface CursorState {
  ts: number;
  eventId: string;
}

export async function readCursor(
  redis: PropagationRedisClient,
  track: PropagationTrack,
  clientId: string
): Promise<CursorState | null> {
  const raw = await redis.hGetAll(cursorKey(track, clientId));
  if (!raw || Object.keys(raw).length === 0) return null;
  const ts = Number(raw.ts);
  const eventId = raw.eventId;
  if (!Number.isFinite(ts) || typeof eventId !== "string" || eventId.length === 0) return null;
  return { ts, eventId };
}

export async function writeCursor(
  redis: PropagationRedisClient,
  track: PropagationTrack,
  clientId: string,
  state: CursorState
): Promise<void> {
  await redis.hSet(cursorKey(track, clientId), { ts: String(state.ts), eventId: state.eventId });
}

// Returns true if `incoming` is strictly newer than `current`. A null current means
// nothing was ever seen, so any incoming event is newer.
export function isStrictlyNewer(current: CursorState | null, incoming: CursorState) {
  if (current === null) return true;
  if (incoming.ts > current.ts) return true;
  if (incoming.ts < current.ts) return false;
  return incoming.eventId > current.eventId;
}
