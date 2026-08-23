import { Prisma } from "@prisma/client";

export function toMoneyString(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export function parseMoney(value: unknown): Prisma.Decimal {
  return new Prisma.Decimal(value as string | number);
}

export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function todayUtc(): Date {
  const now = new Date();
  return startOfDayUtc(now);
}

export type DueState = "upcoming" | "today" | "overdue";

export function resolveDueState(dueDate: Date, status: string): DueState | null {
  if (status !== "OPEN") return null;
  const due = startOfDayUtc(dueDate).getTime();
  const today = todayUtc().getTime();
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}
