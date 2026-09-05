import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";
import { countSiteRelationsForPurge } from "./site-delete-guard";

const DELETE_FAILED = "Site silinemedi. Lütfen tekrar deneyin.";

export async function getSiteDeletePreview(tenantId: string, siteId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId },
    select: { id: true, name: true },
  });
  if (!site) throw new HttpError(404, "Site bulunamadı.");
  const counts = await countSiteRelationsForPurge(tenantId, siteId);
  return { site, counts };
}

export async function permanentlyDeleteSite(
  tenantId: string,
  siteId: string,
  confirmName: string,
): Promise<void> {
  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId },
    select: { id: true, name: true },
  });
  if (!site) throw new HttpError(404, "Site bulunamadı.");
  if (confirmName.trim() !== site.name) {
    throw new HttpError(400, "Site adı doğrulanamadı.");
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const buildings = await tx.building.findMany({
          where: { tenantId, siteId },
          select: { id: true },
        });
        const buildingIds = buildings.map((item) => item.id);
        const apartments = buildingIds.length
          ? await tx.apartment.findMany({
              where: { tenantId, buildingId: { in: buildingIds } },
              select: { id: true },
            })
          : [];
        const apartmentIds = apartments.map((item) => item.id);
        const announcements = await tx.announcement.findMany({
          where: { tenantId, siteId },
          select: { id: true },
        });
        const announcementIds = announcements.map((item) => item.id);
        const bankAccounts = await tx.bankAccount.findMany({
          where: { tenantId, siteId },
          select: { id: true },
        });
        const bankAccountIds = bankAccounts.map((item) => item.id);
        const batches = await tx.communicationBatch.findMany({
          where: { tenantId, siteId },
          select: { id: true },
        });
        const batchIds = batches.map((item) => item.id);

        if (apartmentIds.length > 0) {
          await tx.announcementApartment.deleteMany({
            where: { tenantId, apartmentId: { in: apartmentIds } },
          });
          await tx.paymentAllocation.deleteMany({
            where: { tenantId, apartmentDebt: { tenantId, apartmentId: { in: apartmentIds } } },
          });
          const payments = await tx.payment.findMany({
            where: { tenantId, apartmentId: { in: apartmentIds } },
            select: { id: true },
          });
          const paymentIds = payments.map((item) => item.id);
          if (paymentIds.length > 0) {
            await tx.paymentIdempotencyKey.deleteMany({
              where: { tenantId, paymentId: { in: paymentIds } },
            });
            await tx.bankTransaction.updateMany({
              where: { tenantId, paymentId: { in: paymentIds } },
              data: { paymentId: null },
            });
          }
          await tx.bankTransaction.updateMany({
            where: { tenantId, matchedApartmentId: { in: apartmentIds } },
            data: { matchedApartmentId: null },
          });
        }
        if (buildingIds.length > 0) {
          await tx.announcementBuilding.deleteMany({
            where: { tenantId, buildingId: { in: buildingIds } },
          });
        }
        if (batchIds.length > 0) {
          await tx.communicationIdempotencyKey.deleteMany({
            where: { tenantId, batchId: { in: batchIds } },
          });
        }
        await tx.communicationMessage.deleteMany({ where: { tenantId, siteId } });
        await tx.communicationBatch.deleteMany({ where: { tenantId, siteId } });

        if (announcementIds.length > 0) {
          await tx.announcementApartment.deleteMany({
            where: { tenantId, announcementId: { in: announcementIds } },
          });
          await tx.announcementBuilding.deleteMany({
            where: { tenantId, announcementId: { in: announcementIds } },
          });
        }
        await tx.announcement.deleteMany({ where: { tenantId, siteId } });

        await tx.feedbackStatusHistory.deleteMany({ where: { tenantId, siteId } });
        await tx.feedbackRecord.deleteMany({ where: { tenantId, siteId } });

        await tx.assetMovement.deleteMany({ where: { tenantId, siteId } });
        await tx.assetMaintenance.deleteMany({ where: { tenantId, siteId } });
        await tx.asset.deleteMany({ where: { tenantId, siteId } });

        await tx.bankMatchingRule.deleteMany({ where: { tenantId, siteId } });
        if (bankAccountIds.length > 0) {
          await tx.bankTransaction.deleteMany({
            where: { tenantId, bankAccountId: { in: bankAccountIds } },
          });
        }
        await tx.bankAccount.deleteMany({ where: { tenantId, siteId } });

        await tx.expense.deleteMany({ where: { tenantId, siteId } });

        await tx.interestApplication.deleteMany({ where: { tenantId, siteId } });
        await tx.interestDecision.deleteMany({ where: { tenantId, siteId } });

        if (apartmentIds.length > 0) {
          await tx.payment.deleteMany({ where: { tenantId, apartmentId: { in: apartmentIds } } });
          await tx.apartmentDebt.deleteMany({ where: { tenantId, apartmentId: { in: apartmentIds } } });
          await tx.visit.deleteMany({ where: { tenantId, apartmentId: { in: apartmentIds } } });
          await tx.apartmentPersonRelation.deleteMany({
            where: { tenantId, apartmentId: { in: apartmentIds } },
          });
        }
        if (buildingIds.length > 0) {
          await tx.duesDefinition.deleteMany({
            where: { tenantId, buildingId: { in: buildingIds } },
          });
        }

        await tx.employeeAssignment.deleteMany({ where: { tenantId, siteId } });
        await tx.membershipSiteAccess.deleteMany({
          where: { siteId, membership: { tenantId } },
        });

        if (apartmentIds.length > 0) {
          await tx.apartment.deleteMany({ where: { tenantId, id: { in: apartmentIds } } });
        }
        await tx.building.deleteMany({ where: { tenantId, siteId } });
        await tx.site.deleteMany({ where: { id: siteId, tenantId } });
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
}
