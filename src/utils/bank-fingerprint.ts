import { createHash } from "crypto";
import { normalizeBankText } from "./bank-text";

export function computeBankImportFingerprint(input: {
  transactionDate: string; // YYYY-MM-DD
  direction: "CREDIT" | "DEBIT";
  amount: number;
  description: string;
  referenceNo?: string | null;
  balanceAfter?: number | null;
}): string {
  const parts = [
    input.transactionDate.slice(0, 10),
    input.direction,
    Number(input.amount).toFixed(2),
    normalizeBankText(input.description),
    normalizeBankText(input.referenceNo ?? ""),
    input.balanceAfter != null && !Number.isNaN(Number(input.balanceAfter))
      ? Number(input.balanceAfter).toFixed(2)
      : "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function suggestMatchPattern(description: string, preferredName?: string | null): string {
  const normalized = normalizeBankText(description);
  if (preferredName) {
    const name = normalizeBankText(preferredName);
    if (name.length >= 4 && normalized.includes(name)) return preferredName.trim();
  }
  const cleaned = description
    .replace(/\b(Gönderen|Gond|Gönd|FAST|HAVALE|EFT|ATM|POS|IBAN)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter((w) => w.length >= 2).slice(0, 3);
  return words.join(" ").slice(0, 80);
}
