import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatWeight(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  return `${kg.toFixed(3)} kg`;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function getVarianceColor(variance: number): string {
  if (variance === 0) return "text-green-600";
  if (variance < 0) return "text-red-600";
  return "text-amber-600";
}

export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    salesperson: "Salesperson",
    supervisor: "Supervisor",
    accountant: "Accountant",
    admin: "Admin / Owner",
  };
  return labels[role] ?? role;
}

export function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    salesperson: "bg-blue-100 text-blue-800",
    supervisor: "bg-purple-100 text-purple-800",
    accountant: "bg-green-100 text-green-800",
    admin: "bg-red-100 text-red-800",
  };
  return colors[role] ?? "bg-gray-100 text-gray-800";
}
