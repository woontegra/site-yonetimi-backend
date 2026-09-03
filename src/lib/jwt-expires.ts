/**
 * JWT süre çözümleyici (env ve jwt katmanları tarafından paylaşılır).
 * - Saf sayı (örn. "900"): saniye (jsonwebtoken sayı kuralı)
 * - Birimli string (örn. "15m", "7d"): jsonwebtoken/ms sözdizimi
 * - Boş/geçersiz: fallback
 */
export function resolveExpiresIn(raw: string | undefined, fallback: string): string | number {
  const value = (raw ?? fallback).trim();
  if (!value) return fallback;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
    return seconds;
  }

  const compact = value.replace(/\s+/g, "");
  if (/^\d+(\.\d+)?(ms|s|m|h|d|w|y)$/i.test(compact)) {
    return compact;
  }

  return fallback;
}

/** İnsan okunur süre (log için; secret içermez). */
export function describeExpiresIn(value: string | number): string {
  if (typeof value === "number") return `${value}s`;
  return String(value);
}

/** Yaklaşık saniye (test/doğrulama için). */
export function expiresInToSeconds(value: string | number): number | null {
  if (typeof value === "number") return value;
  const match = String(value)
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const mult: Record<string, number> = {
    ms: 1 / 1000,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    y: 31536000,
  };
  const factor = mult[unit];
  if (!factor || !Number.isFinite(amount)) return null;
  return Math.round(amount * factor);
}
