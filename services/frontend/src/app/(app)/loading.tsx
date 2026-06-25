import PageSkeleton from "@/components/layout/PageSkeleton";

// Streamed instantly on every navigation within the patient app while the server component fetches.
export default function Loading() {
  return <PageSkeleton />;
}
