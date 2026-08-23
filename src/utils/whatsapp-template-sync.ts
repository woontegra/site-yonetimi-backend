import type { WhatsAppTemplateSource } from "@prisma/client";

export function preserveSourceOnMetaSync(
  existingSource: WhatsAppTemplateSource | null | undefined,
): WhatsAppTemplateSource | undefined {
  if (existingSource === "LIBRARY" || existingSource === "CUSTOM") {
    return existingSource;
  }
  return undefined;
}

export function extractMetaRejectionReason(meta: {
  rejected_reason?: string;
  rejection_reason?: string;
}): string | null {
  return meta.rejected_reason ?? meta.rejection_reason ?? null;
}
