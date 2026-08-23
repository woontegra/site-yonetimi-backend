export type MessageTemplateVariables = {
  adSoyad: string;
  siteAdi: string;
  binaAdi: string;
  daireNo: string;
  borcTutari: string;
  vadeTarihi: string;
  borcAciklamasi: string;
};

export const MESSAGE_TEMPLATE_VARIABLE_KEYS = [
  "adSoyad",
  "siteAdi",
  "binaAdi",
  "daireNo",
  "borcTutari",
  "vadeTarihi",
  "borcAciklamasi",
] as const;

export type MessageTemplateVariableKey = (typeof MESSAGE_TEMPLATE_VARIABLE_KEYS)[number];

export const DEFAULT_DEBT_REMINDER_TEMPLATE_BODY =
  "Sayın {{adSoyad}}, {{siteAdi}} yönetimindeki {{binaAdi}} / {{daireNo}} numaralı dairenize ait {{borcTutari}} tutarında ödemeniz bulunmaktadır. Son ödeme tarihi: {{vadeTarihi}}.";

/** Ortak şablon renderer — UI içinde string replace dağıtılmaz. */
export function renderMessageTemplate(
  body: string,
  variables: Partial<MessageTemplateVariables>,
): string {
  return body.replace(/\{\{\s*([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key as keyof MessageTemplateVariables];
    return value != null && String(value).length > 0 ? String(value) : "";
  });
}

export function formatTrMoney(amount: number | string): string {
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(num)) return "0,00 ₺";
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)} ₺`;
}

export function formatTrDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}.${month}.${year}`;
}
