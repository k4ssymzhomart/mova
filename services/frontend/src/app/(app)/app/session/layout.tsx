import SessionFlowFrame from "@/components/flow/SessionFlowFrame";

/** Every step of the exercise flow shares one frame, so it persists across steps instead of remounting. */
export default function SessionFlowLayout({ children }: { children: React.ReactNode }) {
  return <SessionFlowFrame>{children}</SessionFlowFrame>;
}
