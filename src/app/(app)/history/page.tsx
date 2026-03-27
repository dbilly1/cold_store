import { HistoryClient } from "./history-client";

export const revalidate = 300; // refresh every 5 minutes

export default function HistoryPage() {
  return <HistoryClient />;
}
