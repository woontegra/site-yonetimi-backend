import { prisma } from "../lib/prisma";

export type ApartmentPersonSummaryDto = {
  id: string;
  fullName: string;
};

export type ApartmentResidentSummaryDto = {
  apartmentId: string;
  apartmentNumber: string;
  buildingName: string;
  activeOwners: ApartmentPersonSummaryDto[];
  activeTenants: ApartmentPersonSummaryDto[];
};

function isRelationActiveNow(
  rel: { isActive: boolean; startDate: Date | null; endDate: Date | null },
  now: Date,
) {
  if (!rel.isActive) return false;
  if (rel.startDate && rel.startDate > now) return false;
  if (rel.endDate && rel.endDate < now) return false;
  return true;
}

/**
 * Site kapsamlı aktif malik/kiracı özetleri — tek sorgu, N+1 yok.
 */
export async function loadApartmentResidentSummaries(
  tenantId: string,
  siteId: string,
  apartmentIds: string[],
): Promise<Map<string, ApartmentResidentSummaryDto>> {
  const uniqueIds = [...new Set(apartmentIds.filter(Boolean))];
  const result = new Map<string, ApartmentResidentSummaryDto>();
  if (uniqueIds.length === 0) return result;

  const now = new Date();
  const rows = await prisma.apartment.findMany({
    where: {
      tenantId,
      id: { in: uniqueIds },
      deletedAt: null,
      building: { siteId, deletedAt: null },
    },
    select: {
      id: true,
      number: true,
      building: { select: { name: true } },
      relations: {
        where: {
          isActive: true,
          relationType: { in: ["OWNER", "TENANT"] },
          person: { deletedAt: null, isActive: true },
        },
        select: {
          relationType: true,
          isPrimary: true,
          isActive: true,
          startDate: true,
          endDate: true,
          person: {
            select: { id: true, firstName: true, lastName: true, isActive: true, deletedAt: true },
          },
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  for (const row of rows) {
    const active = row.relations.filter(
      (rel) =>
        rel.person.deletedAt == null &&
        rel.person.isActive &&
        isRelationActiveNow(rel, now),
    );
    const owners = active
      .filter((r) => r.relationType === "OWNER")
      .map((r) => ({
        id: r.person.id,
        fullName: `${r.person.firstName} ${r.person.lastName}`.trim(),
      }));
    const tenants = active
      .filter((r) => r.relationType === "TENANT")
      .map((r) => ({
        id: r.person.id,
        fullName: `${r.person.firstName} ${r.person.lastName}`.trim(),
      }));

    result.set(row.id, {
      apartmentId: row.id,
      apartmentNumber: row.number,
      buildingName: row.building.name,
      activeOwners: owners,
      activeTenants: tenants,
    });
  }

  return result;
}

/** Banka gönderen / açıklamadan payer adı (kişisel veri sızdırmaz; yalnız satır etiketi). */
export function extractPayerNameHint(
  senderName: string | null | undefined,
  description: string | null | undefined,
): string | null {
  if (senderName?.trim()) return senderName.trim();
  if (!description?.trim()) return null;
  const parts = description
    .split("*")
    .map((p) => p.trim())
    .filter(Boolean);
  const noise =
    /eyl[uü]l|ekim|kas[iı]m|aral[iı]k|ocak|subat|şubat|mart|nisan|may[iı]s|haziran|temmuz|a[gğ]ustos|aidat|site|daire|\bno\b|\d{4}/i;
  const candidates = parts.filter(
    (p) => !noise.test(p) && !/^\d+$/.test(p) && /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(p),
  );
  const pick = candidates[0] ?? null;
  return pick ? pick.replace(/\s+/g, " ").trim() : null;
}
