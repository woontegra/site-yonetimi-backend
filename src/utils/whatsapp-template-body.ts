import type { MetaTemplateComponent } from "../services/meta-whatsapp-client";

const TR_CHAR_MAP: Record<string, string> = {
  ğ: "g",
  ü: "u",
  ş: "s",
  ı: "i",
  ö: "o",
  ç: "c",
  Ğ: "g",
  Ü: "u",
  Ş: "s",
  İ: "i",
  Ö: "o",
  Ç: "c",
};

export type BodyValidationResult = { valid: true } | { valid: false; error: string };

export function validateBodyForMeta(body: string): BodyValidationResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { valid: false, error: "Şablon metni boş olamaz." };
  }

  const matches = [...trimmed.matchAll(/\{\{(\d+)\}\}/g)];
  if (matches.length === 0) {
    return { valid: true };
  }

  const nums = matches.map((match) => Number(match[1]));
  const uniqueSorted = [...new Set(nums)].sort((a, b) => a - b);

  for (let i = 0; i < uniqueSorted.length; i += 1) {
    if (uniqueSorted[i] !== i + 1) {
      return {
        valid: false,
        error: "Değişken numaraları sıralı olmalıdır ({{1}}, {{2}}, ...).",
      };
    }
  }

  if (/^\{\{\d+\}\}/.test(trimmed)) {
    return { valid: false, error: "Şablon metni değişken ile başlayamaz." };
  }
  if (/\{\{\d+\}\}$/.test(trimmed)) {
    return { valid: false, error: "Şablon metni değişken ile bitemez." };
  }

  const withoutVars = trimmed.replace(/\{\{\d+\}\}/g, "").trim();
  if (!withoutVars) {
    return { valid: false, error: "Şablon metni yalnızca değişkenlerden oluşamaz." };
  }

  return { valid: true };
}

export function buildComponentsJson(bodyText: string): MetaTemplateComponent[] {
  return [{ type: "BODY", text: bodyText }];
}

export function bodyToNamedPreviewBody(
  bodyText: string,
  mapping: Record<string, string> | null | undefined,
): string {
  if (!mapping) return bodyText;
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_match, num: string) => {
    const key = mapping[num];
    return key ? `{{${key}}}` : `{{${num}}}`;
  });
}

export function normalizeMetaTemplateName(display: string): string {
  let normalized = display
    .trim()
    .split("")
    .map((char) => TR_CHAR_MAP[char] ?? char)
    .join("")
    .toLowerCase();
  normalized = normalized.replace(/[^a-z0-9]+/g, "_");
  normalized = normalized.replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  if (!normalized) return "template";
  return normalized.slice(0, 512);
}

export function countBodyVariables(bodyText: string): number {
  const matches = bodyText.match(/\{\{\d+\}\}/g);
  if (!matches) return 0;
  const nums = matches.map((match) => Number(match.replace(/\D/g, "")));
  return nums.length > 0 ? Math.max(...nums) : 0;
}
