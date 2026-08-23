/**
 * Türkiye telefon numarası normalizasyonu.
 * Desteklenen girdiler: 05xxxxxxxxx, 5xxxxxxxxx, +905xxxxxxxxx, 905xxxxxxxxx
 * Canonical çıktı: +905XXXXXXXXX
 */

export function normalizeTrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "").trim();
  if (!digits) return null;

  let national = digits;
  if (national.startsWith("+")) {
    national = national.slice(1);
  }
  if (national.startsWith("90") && national.length >= 12) {
    national = national.slice(2);
  }
  if (national.startsWith("0") && national.length >= 11) {
    national = national.slice(1);
  }

  if (!/^5\d{9}$/.test(national)) {
    return null;
  }

  return `+90${national}`;
}

export function isValidTrPhone(raw: string | null | undefined): boolean {
  return normalizeTrPhone(raw) !== null;
}
