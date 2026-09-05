/**
 * Organizasyon lisansı — merkezi sabitler.
 * Fiyat/KDV env ile override edilebilir; kodun başka yerlerine hard-code edilmez.
 */
export const LICENSE_DEMO_DAYS = 7;
export const LICENSE_ANNUAL_DAYS = 365;

/** Varsayılan yıllık net fiyat (TRY). Env: LICENSE_ANNUAL_NET_PRICE */
export function annualNetPrice(): number {
  const raw = process.env.LICENSE_ANNUAL_NET_PRICE?.trim();
  if (raw) {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return 4000;
}

/** KDV oranı yüzde (örn. 20). Env: LICENSE_VAT_RATE */
export function licenseVatRate(): number {
  const raw = process.env.LICENSE_VAT_RATE?.trim();
  if (raw) {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n * 100) / 100;
  }
  return 20;
}

export const LICENSE_CURRENCY = "TRY" as const;

export type LicensePriceSnapshot = {
  netPrice: number;
  vatRate: number;
  vatAmount: number;
  grossPrice: number;
  currency: typeof LICENSE_CURRENCY;
};

/** Decimal-safe KDV (kuruş yuvarlama). */
export function computeLicensePrice(netPrice = annualNetPrice(), vatRate = licenseVatRate()): LicensePriceSnapshot {
  const netCents = Math.round(netPrice * 100);
  const vatCents = Math.round((netCents * vatRate) / 100);
  return {
    netPrice: netCents / 100,
    vatRate,
    vatAmount: vatCents / 100,
    grossPrice: (netCents + vatCents) / 100,
    currency: LICENSE_CURRENCY,
  };
}

export function demoPriceSnapshot(): LicensePriceSnapshot {
  return {
    netPrice: 0,
    vatRate: licenseVatRate(),
    vatAmount: 0,
    grossPrice: 0,
    currency: LICENSE_CURRENCY,
  };
}
