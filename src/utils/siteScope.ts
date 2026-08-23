import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/httpError";

/** Site'in tenant'a ait ve silinmemiş olduğunu doğrular. */
export async function assertSiteInTenant(
  tenantId: string,
  siteId: string,
  options?: { requireActive?: boolean },
): Promise<{ id: string; name: string; isActive: boolean }> {
  const site = await prisma.site.findFirst({
    where: { id: siteId, tenantId, deletedAt: null },
    select: { id: true, name: true, isActive: true },
  });
  if (!site) {
    throw new HttpError(400, "Seçilen site bu hesaba ait değil.");
  }
  if (options?.requireActive !== false && !site.isActive) {
    throw new HttpError(400, "Pasif siteye işlem yapılamaz.");
  }
  return site;
}

/** Building'in verilen siteye ait olduğunu doğrular. */
export async function assertBuildingInSite(
  tenantId: string,
  siteId: string,
  buildingId: string,
): Promise<void> {
  const building = await prisma.building.findFirst({
    where: { id: buildingId, tenantId, siteId, deletedAt: null },
    select: { id: true },
  });
  if (!building) {
    throw new HttpError(400, "Seçilen bina bu siteye ait değil.");
  }
}

/** Apartment'ın verilen site zincirinde olduğunu doğrular. */
export async function assertApartmentInSite(
  tenantId: string,
  siteId: string,
  apartmentId: string,
): Promise<{ id: string; buildingId: string }> {
  const apartment = await prisma.apartment.findFirst({
    where: {
      id: apartmentId,
      tenantId,
      deletedAt: null,
      building: { siteId, deletedAt: null },
    },
    select: { id: true, buildingId: true },
  });
  if (!apartment) {
    throw new HttpError(400, "Seçilen daire bu siteye ait değil.");
  }
  return apartment;
}

/** Banka hesabının verilen siteye ait olduğunu doğrular. */
export async function assertBankAccountInSite(
  tenantId: string,
  siteId: string,
  bankAccountId: string,
): Promise<void> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, tenantId, siteId, deletedAt: null },
    select: { id: true },
  });
  if (!account) {
    throw new HttpError(400, "Seçilen banka hesabı bu siteye ait değil.");
  }
}

export function apartmentSiteWhere(siteId: string) {
  return { building: { siteId, deletedAt: null } } as const;
}
