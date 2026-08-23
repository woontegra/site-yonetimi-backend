/**
 * Simple assert script for WhatsApp status rank helpers (no test runner in project).
 * Run: npx tsx scripts/test-whatsapp-status-rank.ts
 */
import assert from "node:assert/strict";
import {
  communicationMessageStatusRank,
  isSuccessfulDeliveryStatus,
  mapMetaWebhookStatus,
  shouldUpdateMessageStatus,
} from "../src/utils/whatsapp-message-status";

assert.equal(communicationMessageStatusRank("PENDING"), 0);
assert.equal(communicationMessageStatusRank("SENT"), 1);
assert.equal(communicationMessageStatusRank("DELIVERED"), 2);
assert.equal(communicationMessageStatusRank("READ"), 3);

assert.equal(shouldUpdateMessageStatus("PENDING", "SENT"), true);
assert.equal(shouldUpdateMessageStatus("SENT", "DELIVERED"), true);
assert.equal(shouldUpdateMessageStatus("DELIVERED", "READ"), true);
assert.equal(shouldUpdateMessageStatus("READ", "DELIVERED"), false);
assert.equal(shouldUpdateMessageStatus("SENT", "PENDING"), false);
assert.equal(shouldUpdateMessageStatus("FAILED", "SENT"), false);
assert.equal(shouldUpdateMessageStatus("SENT", "FAILED"), true);

assert.equal(mapMetaWebhookStatus("sent"), "SENT");
assert.equal(mapMetaWebhookStatus("delivered"), "DELIVERED");
assert.equal(mapMetaWebhookStatus("read"), "READ");
assert.equal(mapMetaWebhookStatus("failed"), "FAILED");
assert.equal(mapMetaWebhookStatus("unknown"), null);

assert.equal(isSuccessfulDeliveryStatus("SENT"), true);
assert.equal(isSuccessfulDeliveryStatus("DELIVERED"), true);
assert.equal(isSuccessfulDeliveryStatus("READ"), true);
assert.equal(isSuccessfulDeliveryStatus("FAILED"), false);

console.log("whatsapp-status-rank: all assertions passed");
