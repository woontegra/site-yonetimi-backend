import type { CommunicationMessageStatus } from "@prisma/client";

const STATUS_RANK: Record<CommunicationMessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: -1,
  CANCELLED: -2,
};

export function communicationMessageStatusRank(
  status: CommunicationMessageStatus,
): number {
  return STATUS_RANK[status] ?? -99;
}

export function shouldUpdateMessageStatus(
  current: CommunicationMessageStatus,
  incoming: CommunicationMessageStatus,
): boolean {
  if (current === incoming) return false;
  if (incoming === "FAILED") return current !== "FAILED";
  if (current === "FAILED" || current === "CANCELLED") return false;

  const currentRank = communicationMessageStatusRank(current);
  const incomingRank = communicationMessageStatusRank(incoming);
  if (incomingRank < 0) return false;
  return incomingRank > currentRank;
}

export function mapMetaWebhookStatus(
  metaStatus: string,
): CommunicationMessageStatus | null {
  switch (metaStatus.toLowerCase()) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    default:
      return null;
  }
}

export function isSuccessfulDeliveryStatus(status: CommunicationMessageStatus): boolean {
  return status === "SENT" || status === "DELIVERED" || status === "READ";
}
