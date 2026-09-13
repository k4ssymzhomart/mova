// The exercise flow's steps and how a URL maps onto them. Pure, so the frame and the tests share it.
//
//   /app/session/new/<prescriptionId>   1 sensors    (no session row yet)
//   /app/session/<id>/calibrate         2 calibrate
//   /app/session/<id>/exercise          3 exercise
//   /app/session/<id>/check-in          4 checkIn
//   /app/session/<id>/summary           5 summary
//   /app/session/<id>/stop              RED instruction (outside the numbered steps)

export type FlowStepId = "sensors" | "calibrate" | "exercise" | "checkIn" | "summary";

export const FLOW_STEPS: readonly FlowStepId[] = ["sensors", "calibrate", "exercise", "checkIn", "summary"];

const SEGMENT_TO_STEP: Record<string, FlowStepId | "stop"> = {
  calibrate: "calibrate",
  exercise: "exercise",
  "check-in": "checkIn",
  summary: "summary",
  stop: "stop",
};

export const STEP_SEGMENT: Record<Exclude<FlowStepId, "sensors">, string> = {
  calibrate: "calibrate",
  exercise: "exercise",
  checkIn: "check-in",
  summary: "summary",
};

export interface FlowLocation {
  step: FlowStepId | "stop" | null;
  prescriptionId: string | null;
  sessionId: string | null;
}

export function flowLocation(pathname: string): FlowLocation {
  const parts = pathname.split("/").filter(Boolean); // ["app", "session", ...]
  if (parts[0] !== "app" || parts[1] !== "session") return { step: null, prescriptionId: null, sessionId: null };
  if (parts[2] === "new") {
    return parts[3]
      ? { step: "sensors", prescriptionId: decodeURIComponent(parts[3]), sessionId: null }
      : { step: null, prescriptionId: null, sessionId: null };
  }
  if (parts[2] && parts[3] && SEGMENT_TO_STEP[parts[3]]) {
    return { step: SEGMENT_TO_STEP[parts[3]], prescriptionId: null, sessionId: decodeURIComponent(parts[2]) };
  }
  return { step: null, prescriptionId: null, sessionId: parts[2] ? decodeURIComponent(parts[2]) : null };
}

export function stepHref(sessionId: string, step: Exclude<FlowStepId, "sensors">): string {
  return `/app/session/${encodeURIComponent(sessionId)}/${STEP_SEGMENT[step]}`;
}
