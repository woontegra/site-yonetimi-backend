import type { CommunicationMessageStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  isSuccessfulDeliveryStatus,
  mapMetaWebhookStatus,
  shouldUpdateMessageStatus,
} from "../utils/whatsapp-message-status";

type WebhookStatusUpdate = {
  providerMessageId: string;
  status: CommunicationMessageStatus;
  errorMessage?: string | null;
};

export async function processWhatsAppStatusUpdates(
  updates: WebhookStatusUpdate[],
): Promise<void> {
  for (const update of updates) {
    await processSingleStatusUpdate(update);
  }
}

async function processSingleStatusUpdate(update: WebhookStatusUpdate): Promise<void> {
  const message = await prisma.communicationMessage.findFirst({
    where: { providerMessageId: update.providerMessageId },
    include: { batch: true },
  });

  if (!message) return;

  if (!shouldUpdateMessageStatus(message.status, update.status)) return;

  await prisma.$transaction(async (tx) => {
    await tx.communicationMessage.update({
      where: { id: message.id },
      data: {
        status: update.status,
        ...(update.status === "FAILED"
          ? { errorMessage: update.errorMessage ?? "WhatsApp mesajı iletilemedi." }
          : {}),
        ...(update.status === "SENT" && !message.sentAt ? { sentAt: new Date() } : {}),
      },
    });

    if (message.batchId) {
      const batchMessages = await tx.communicationMessage.findMany({
        where: { batchId: message.batchId },
        select: { status: true },
      });

      const sentCount = batchMessages.filter((m) =>
        isSuccessfulDeliveryStatus(m.status),
      ).length;
      const failedCount = batchMessages.filter((m) => m.status === "FAILED").length;

      await tx.communicationBatch.update({
        where: { id: message.batchId },
        data: { sentCount, failedCount },
      });
    }
  });
}

export function extractWebhookStatusUpdates(payload: unknown): WebhookStatusUpdate[] {
  const updates: WebhookStatusUpdate[] = [];
  if (!payload || typeof payload !== "object") return updates;

  const entry = (payload as { entry?: unknown[] }).entry;
  if (!Array.isArray(entry)) return updates;

  for (const item of entry) {
    const changes = (item as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: { statuses?: unknown[] } }).value;
      const statuses = value?.statuses;
      if (!Array.isArray(statuses)) continue;

      for (const statusItem of statuses) {
        const providerMessageId = (statusItem as { id?: string }).id;
        const metaStatus = (statusItem as { status?: string }).status;
        if (!providerMessageId || !metaStatus) continue;

        const mapped = mapMetaWebhookStatus(metaStatus);
        if (!mapped) continue;

        let errorMessage: string | null = null;
        if (mapped === "FAILED") {
          const errors = (statusItem as { errors?: Array<{ title?: string; message?: string }> })
            .errors;
          errorMessage =
            errors?.[0]?.message ?? errors?.[0]?.title ?? "WhatsApp mesajı iletilemedi.";
        }

        updates.push({
          providerMessageId,
          status: mapped,
          errorMessage,
        });
      }
    }
  }

  return updates;
}
