"use client";

// CareMessenger — an elegant, minimal message thread with the care team. The transport is mocked (no
// comms backend wired yet) but the thread persists on-device, scoped per user, so it behaves like a real
// inbox: send a note, it's delivered and remembered. Editorial Spatial, lucide icons.

import { Check, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface Message {
  id: string;
  from: "you" | "clinician";
  text: string;
  at: number;
}

function threadKey(uid: string) {
  return `mova.care.thread::${uid}`;
}

export default function CareMessenger({ clinicianName, userId }: { clinicianName: string; userId: string }) {
  const seed: Message[] = [
    {
      id: "seed-1",
      from: "clinician",
      text: `Hi — great work this week. Keep the cadence steady and let me know if any movement feels painful. — ${clinicianName}`,
      at: Date.now() - 1000 * 60 * 60 * 20,
    },
  ];
  const [messages, setMessages] = useState<Message[]>(seed);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(threadKey(userId));
      if (raw) setMessages(JSON.parse(raw) as Message[]);
    } catch {
      /* keep seed */
    }
  }, [userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  function send() {
    const t = text.trim();
    if (!t) return;
    const next = [...messages, { id: `m_${Date.now()}`, from: "you" as const, text: t, at: Date.now() }];
    setMessages(next);
    setText("");
    try {
      window.localStorage.setItem(threadKey(userId), JSON.stringify(next));
    } catch {
      /* non-fatal */
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-card">
      <div className="border-b border-line px-6 py-4">
        <h2 className="text-xl text-ink">Message your therapist</h2>
        <p className="text-[13px] text-ink-soft">Non-urgent questions about your program. Replies within 1–2 days.</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5" style={{ maxHeight: "22rem" }}>
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.from === "you" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] rounded-lg px-4 py-2.5 text-[14px] leading-relaxed",
                m.from === "you" ? "bg-night text-paper-soft" : "border border-line bg-paper-soft text-ink",
              )}
            >
              {m.text}
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 font-mono text-[10px]",
                  m.from === "you" ? "text-paper/45" : "text-ink-faint",
                )}
              >
                {new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                {m.from === "you" && <Check className="size-3" strokeWidth={2.4} />}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Write a message…"
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-paper-soft px-3.5 py-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-signal focus:bg-card focus:ring-2 focus:ring-signal/20"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim()}
            aria-label="Send message"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-signal text-white transition-colors hover:bg-signal-bright disabled:opacity-40"
          >
            <Send className="size-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
