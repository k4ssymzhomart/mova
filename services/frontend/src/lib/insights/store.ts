"use client";

// Local, on-device session store. Phase-4 has no backend wired, so progression history lives in
// localStorage (privacy-first — performance data never leaves the device, mirroring the raw-video
// guarantee). The shape matches the eventual Supabase `sessions` table so swapping the backend later
// is a drop-in.

import type { SessionRecord } from "./types";

const KEY = "mova.sessions.v1";

export function loadSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionRecord[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => a.startedAt - b.startedAt) : [];
  } catch {
    return [];
  }
}

export function saveSession(record: SessionRecord): SessionRecord[] {
  if (typeof window === "undefined") return [];
  const all = [...loadSessions(), record].slice(-200); // keep the last 200 bouts
  window.localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export function clearSessions(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function makeId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
