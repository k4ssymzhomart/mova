"use client";

// Local, on-device session store. On-device progression history lives in localStorage (privacy-first —
// performance data never leaves the device, mirroring the raw-video guarantee). The shape matches the
// Supabase `sessions` table so swapping the backend later is a drop-in.
//
// Keyed PER USER: every record bucket is namespaced by the authenticated user id, so two accounts on the
// same browser never see each other's history (the local mirror of Supabase RLS). Pass the signed-in
// user's id; omit it only for the un-authenticated/guest case.

import type { SessionRecord } from "./types";

const BASE = "mova.sessions.v1";

/** Per-user storage key; falls back to a shared guest bucket when there is no signed-in user. */
function keyFor(userId?: string | null): string {
  return userId ? `${BASE}::${userId}` : `${BASE}::guest`;
}

export function loadSessions(userId?: string | null): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionRecord[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => a.startedAt - b.startedAt) : [];
  } catch {
    return [];
  }
}

export function saveSession(record: SessionRecord, userId?: string | null): SessionRecord[] {
  if (typeof window === "undefined") return [];
  const all = [...loadSessions(userId), record].slice(-200); // keep the last 200 bouts
  window.localStorage.setItem(keyFor(userId), JSON.stringify(all));
  return all;
}

export function clearSessions(userId?: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(userId));
}

export function makeId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
