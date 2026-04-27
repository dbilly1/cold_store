import { requireRole } from "@/lib/require-role";
import { HistoryClient } from "./history-client";

export const revalidate = 300; // refresh every 5 minutes

export default async function HistoryPage() {
  await requireRole(["supervisor", "accountant", "admin"]);
  return <HistoryClient />;
}
