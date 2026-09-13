"use client";

// The shell's slot for the НТЗ §15 RED state. When RED is raised, AppShell stops rendering the current page
// and shows SafetyStopPanel in its place, so whatever flow was running unmounts rather than sitting behind an
// overlay (an overlay would also be invisible behind a fullscreen exercise stage).
//
// This file owns the slot only. It does not decide when RED is raised, what the instruction says, or who may
// clear it — those are clinical rules. TODO(#22): the session flow calls raiseRed() once the §15 rules and the
// approved instruction text exist. Nothing calls it yet.

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export const PENDING_INSTRUCTION_KEY = "safety.red.instructionPending";

export type SafetyState =
  | { level: "none" }
  | { level: "red"; instructionKey: string; sessionId: string | null; raisedAt: number };

interface SafetyContextValue {
  state: SafetyState;
  raiseRed: (input?: { instructionKey?: string; sessionId?: string | null }) => void;
  clear: () => void;
}

const SafetyContext = createContext<SafetyContextValue | null>(null);

export function SafetyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SafetyState>({ level: "none" });
  const router = useRouter();

  const raiseRed = useCallback(
    (input?: { instructionKey?: string; sessionId?: string | null }) => {
      if (typeof document !== "undefined" && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
      setState({
        level: "red",
        instructionKey: input?.instructionKey ?? PENDING_INSTRUCTION_KEY,
        sessionId: input?.sessionId ?? null,
        raisedAt: Date.now(),
      });
      // Inside a session, move to its stop route so a reload still shows the instruction. Outside a session there
      // is no route to hold it, so a reload clears the panel.
      if (input?.sessionId) router.replace(`/app/session/${encodeURIComponent(input.sessionId)}/stop`);
    },
    [router],
  );

  // TODO(clinician): who may clear RED (the patient, or only the care team) is undecided.
  const clear = useCallback(() => setState({ level: "none" }), []);

  const value = useMemo(() => ({ state, raiseRed, clear }), [state, raiseRed, clear]);
  return <SafetyContext.Provider value={value}>{children}</SafetyContext.Provider>;
}

export function useSafety(): SafetyContextValue {
  const ctx = useContext(SafetyContext);
  if (!ctx) throw new Error("useSafety must be used inside <SafetyProvider>");
  return ctx;
}
