import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { writeAdminAudit } from "./admin-audit.service";

const DELETE_FAILED = "Tenant silinemedi. Lütfen tekrar deneyin.";

export type TenantDeleteCounts = {
  sites: number;
  buildings: number;
  apartments: number;
  users: number;
  persons: number;
  debts: number;
  payments: number;
  expenses: number;
  integrations: number;
};

export async function isProtectedTenant(tenantId: string): Promise<boolean> {
  if (env.protectedTenantIds.includes(tenantId)) return true;
  const platformOwnerMembership = await prisma.membership.findFirst({
    where: { tenantId, user: { isPlatformAdmin: true } },
    select: { id: true },
  });
  return Boolean(platformOwnerMembership);
}

export async function getTenantDeleteCounts(tenantId: string): Promise<TenantDeleteCounts> {
  const [sites, buildings, apartments, users, persons, debts, payments, expenses, integrations] =
    await Promise.all([
      prisma.site.count({ where: { tenantId } }),
      prisma.building.count({ where: { tenantId } }),
      prisma.apartment.count({ where: { tenantId } }),
      prisma.membership.count({ where: { tenantId } }),
      prisma.person.count({ where: { tenantId } }),
      prisma.apartmentDebt.count({ where: { tenantId } }),
      prisma.payment.count({ where: { tenantId } }),
      prisma.expense.count({ where: { tenantId } }),
      prisma.whatsAppIntegration.count({ where: { tenantId } }),
    ]);
  return { sites, buildings, apartments, users, persons, debts, payments, expenses, integrations };
}

export async function permanentlyDeleteTenant(
  adminUserId: string,
  tenantId: string,
  confirmName: string,
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) throw new HttpError(404, "Tenant bulunamadı.");
  if (confirmName.trim() !== tenant.name) {
    throw new HttpError(400, "Tenant adı doğrulanamadı.");
  }
  if (await isProtectedTenant(tenantId)) {
    throw new HttpError(403, "Korumalı ana tenant silinemez.");
  }

  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  const candidateUserIds = [...new Set(memberships.map((item) => item.userId))];

  try {
    await prisma.$transaction(
      async (tx) => {
        const t = { tenantId };
        await tx.paymentAllocation.deleteMany({ where: t });
        await tx.communicationIdempotencyKey.deleteMany({ where: t });
        await tx.communicationMessage.deleteMany({ where: t });
        await tx.communicationBatch.deleteMany({ where: t });
        await tx.whatsAppTemplate.deleteMany({ where: t });
        await tx.messageTemplate.deleteMany({ where: t });
        await tx.feedbackStatusHistory.deleteMany({ where: t });
        await tx.feedbackRecord.deleteMany({ where: t });
        await tx.feedbackCategory.deleteMany({ where: t });
        await tx.announcementApartment.deleteMany({ where: t });
        await tx.announcementBuilding.deleteMany({ where: t });
        await tx.announcement.deleteMany({ where: t });
        await tx.assetMovement.deleteMany({ where: t });
        await tx.assetMaintenance.deleteMany({ where: t });
        await tx.asset.deleteMany({ where: t });
        await tx.assetCategory.deleteMany({ where: t });
        await tx.visit.deleteMany({ where: t });
        await tx.visitor.deleteMany({ where: t });
        await tx.employeeAssignment.deleteMany({ where: t });
        await tx.employee.deleteMany({ where: t });
        await tx.bankMatchingRule.deleteMany({ where: t });
        await tx.bankTransaction.deleteMany({ where: t });
        await tx.bankAccount.deleteMany({ where: t });
        await tx.expense.deleteMany({ where: t });
        await tx.expenseType.deleteMany({ where: t });
        await tx.payment.deleteMany({ where: t });
        await tx.paymentIdempotencyKey.deleteMany({ where: t });
        await tx.apartmentDebt.deleteMany({ where: t });
        await tx.duesDefinition.deleteMany({ where: t });
        await tx.apartmentPersonRelation.deleteMany({ where: t });
        await tx.person.deleteMany({ where: t });
        await tx.apartment.deleteMany({ where: t });
        await tx.building.deleteMany({ where: t });
        await tx.membership.deleteMany({ where: t });
        await tx.tenantAuditLog.deleteMany({ where: t });
        await tx.adminNote.deleteMany({ where: t });
        await tx.subscription.deleteMany({ where: t });
        await tx.emailDelivery.updateMany({
          where: { relatedTenantId: tenantId },
          data: { relatedTenantId: null },
        });
        await tx.whatsAppIntegration.deleteMany({ where: t });
        await tx.site.deleteMany({ where: t });
        await tx.adminAuditLog.updateMany({
          where: { tenantId },
          data: { tenantId: null },
        });
        await tx.tenant.delete({ where: { id: tenantId } });

        if (candidateUserIds.length > 0) {
          const remaining = await tx.user.findMany({
            where: { id: { in: candidateUserIds } },
            select: {
              id: true,
              isPlatformAdmin: true,
              _count: {
                select: {
                  memberships: true,
                  tenantAuditLogs: true,
                  adminAuditLogs: true,
                  adminNotes: true,
                },
              },
            },
          });
          const orphanIds = remaining
            .filter(
              (user) =>
                !user.isPlatformAdmin &&
                user._count.memberships === 0 &&
                user._count.tenantAuditLogs === 0 &&
                user._count.adminAuditLogs === 0 &&
                user._count.adminNotes === 0,
            )
            .map((user) => user.id);
          if (orphanIds.length > 0) {
            await tx.user.deleteMany({ where: { id: { in: orphanIds } } });
          }
        }
      },
      { timeout: 20000, maxWait: 5000 },
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new HttpError(409, DELETE_FAILED);
    }
    throw new HttpError(500, DELETE_FAILED);
  }

  await writeAdminAudit({
    adminUserId,
    action: "tenant.delete",
    targetType: "Tenant",
    targetId: tenantId,
    tenantId: null,
    metadata: { name: tenant.name },
  });
}
