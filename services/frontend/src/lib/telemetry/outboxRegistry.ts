// Coordination between live TelemetryBuffers and the outbox, within one tab.
//
// A running buffer owns its session's IndexedDB record: it rewrites the record about once a second, so the outbox
// must not send or rewrite it at the same time. start() marks the session active and stop() releases it once the
// record is current. When a stop leaves rows undelivered it bumps the version, which makes a drain in progress take
// one more pass and wakes the outbox scheduler.
//
// Another tab can still drain a record this tab's buffer owns. That only costs duplicate requests, which the flush
// RPC ignores on (session_id, recorded_at, seq).

const active = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

/** Mark a session as owned by a live buffer. Returns the release function; calling it twice is harmless. */
export function markSessionActive(sessionId: string): () => void {
  active.set(sessionId, (active.get(sessionId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (active.get(sessionId) ?? 1) - 1;
    if (left > 0) active.set(sessionId, left);
    else active.delete(sessionId);
  };
}

export function isSessionActive(sessionId: string): boolean {
  return active.has(sessionId);
}

/** Tell the outbox that stored rows changed hands (a buffer stopped with rows still undelivered). */
export function notifyOutbox(): void {
  version += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* a listener's failure must not stop the others */
    }
  }
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function outboxVersion(): number {
  return version;
}
