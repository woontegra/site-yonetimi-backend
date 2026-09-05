import type { FinanceIssueCode, FinanceIssueSeverity } from "./codes";

export type FinanceIssue = {
  code: FinanceIssueCode;
  severity: FinanceIssueSeverity;
  title: string;
  message: string;
  apartmentId?: string;
  debtId?: string;
  paymentId?: string;
  bankTransactionId?: string;
  period?: string | null;
  amount?: string;
  details?: Record<string, unknown>;
};

export type ProposedAllocationLine = {
  apartmentDebtId: string;
  title: string;
  periodYear: number | null;
  periodMonth: number | null;
  periodLabel: string | null;
  amount: string;
  remainingBefore: string;
  remainingAfter: string;
};

export type DebtBalanceSnapshot = {
  apartmentDebtId: string;
  remainingAmount: string;
};

export type FinanceCheckResult = {
  allowed: boolean;
  requiresConfirmation: boolean;
  issues: FinanceIssue[];
  summary: Record<string, unknown>;
  proposedAllocation: ProposedAllocationLine[];
  debtSnapshot: DebtBalanceSnapshot[];
};

export function emptyFinanceCheck(
  summary: Record<string, unknown> = {},
): FinanceCheckResult {
  return {
    allowed: true,
    requiresConfirmation: false,
    issues: [],
    summary,
    proposedAllocation: [],
    debtSnapshot: [],
  };
}

export function finalizeFinanceCheck(result: FinanceCheckResult): FinanceCheckResult {
  const hasBlock = result.issues.some((issue) => issue.severity === "BLOCK");
  const hasWarning = result.issues.some((issue) => issue.severity === "WARNING");
  return {
    ...result,
    allowed: !hasBlock,
    requiresConfirmation: !hasBlock && hasWarning,
  };
}
