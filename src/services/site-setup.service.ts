import { Prisma, type SiteSetupStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertApartmentInSite, assertBuildingInSite } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import { normalizeTrPhone } from "../utils/phone";
import type {
  AssignResidentInput,
  BulkApartmentsInput,
  BulkBuildingsInput,
  ImportRowInput,
  ResidentImportRowInput,
} from "../validators/site-setup.validators";

const setupSiteSelect = {
  id: true,
  name: true,
  setupStatus: true,
  setupCompletedAt: true,
  city: true,
  district: true,
  address: true,
} as const;

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const relationSelect = {
  id: true,
  relationType: true,
  isPrimary: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type NormalizedImportRow = {
  buildingName: string;
  apartmentNumber: string;
  floor: string | null;
  roomType: string | null;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerPhone?: string | null;
  tenantFirstName?: string;
  tenantLastName?: string;
  tenantPhone?: string | null;
};

export class SiteSetupService {
  async getSummary(tenantId: string, siteId: string) {
    const site = await prisma.site.findFirst({
      where: { id: siteId, tenantId, deletedAt: null },
      select: setupSiteSelect,
    });

    if (!site) {
      throw new HttpError(404, "Site bulunamadı.");
    }

    const siteApartmentWhere: Prisma.ApartmentWhereInput = {
      tenantId,
      deletedAt: null,
      building: { siteId, deletedAt: null },
    };

    const [buildingCount, apartmentCount, ownerCount, tenantCount, apartmentsWithoutResident, buildings] =
      await Promise.all([
        prisma.building.count({
          where: { tenantId, siteId, deletedAt: null },
        }),
        prisma.apartment.count({ where: siteApartmentWhere }),
        prisma.apartmentPersonRelation.count({
          where: {
            tenantId,
            relationType: "OWNER",
            isActive: true,
            apartment: siteApartmentWhere,
          },
        }),
        prisma.apartmentPersonRelation.count({
          where: {
            tenantId,
            relationType: "TENANT",
            isActive: true,
            apartment: siteApartmentWhere,
          },
        }),
        prisma.apartment.count({
          where: {
            ...siteApartmentWhere,
            relations: {
              none: {
                isActive: true,
                relationType: { in: ["OWNER", "TENANT"] },
              },
            },
          },
        }),
        prisma.building.findMany({
          where: { tenantId, siteId, deletedAt: null },
          select: {
            id: true,
            name: true,
            _count: {
              select: {
                apartments: { where: { deletedAt: null } },
              },
            },
          },
          orderBy: { name: "asc" },
        }),
      ]);

    return {
      site,
      counts: {
        buildings: buildingCount,
        apartments: apartmentCount,
        owners: ownerCount,
        tenants: tenantCount,
        apartmentsWithoutResident,
      },
      buildings: buildings.map(({ _count, ...building }) => ({
        ...building,
        apartmentCount: _count.apartments,
      })),
    };
  }

  async updateStatus(tenantId: string, siteId: string, status: SiteSetupStatus) {
    const site = await prisma.site.findFirst({
      where: { id: siteId, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!site) {
      throw new HttpError(404, "Site bulunamadı.");
    }

    const setupCompletedAt =
      status === "COMPLETED" || status === "SKIPPED"
        ? new Date()
        : status === "IN_PROGRESS" || status === "NOT_STARTED"
          ? null
          : undefined;

    return prisma.site.update({
      where: { id: siteId },
      data: {
        setupStatus: status,
        setupCompletedAt,
      },
      select: setupSiteSelect,
    });
  }

  async bulkCreateBuildings(
    tenantId: string,
    siteId: string,
    input: BulkBuildingsInput["buildings"],
  ) {
    await this.assertSiteExists(tenantId, siteId);

    const result = await prisma.$transaction(async (tx) => {
      await this.markSetupInProgressTx(tx, tenantId, siteId);

      const createdBuildings: Array<{ id: string; name: string; code: string | null }> = [];
      let apartmentsCreated = 0;

      for (const item of input) {
        const building = await tx.building.create({
          data: {
            tenantId,
            siteId,
            name: item.name,
            code: item.code ?? null,
          },
          select: { id: true, name: true, code: true },
        });

        createdBuildings.push(building);

        if (item.apartmentNumbers && item.apartmentNumbers.length > 0) {
          const uniqueNumbers = [...new Set(item.apartmentNumbers.map((n) => n.trim()).filter(Boolean))];

          const existing = await tx.apartment.findMany({
            where: {
              buildingId: building.id,
              deletedAt: null,
              number: { in: uniqueNumbers },
            },
            select: { number: true },
          });
          const existingSet = new Set(existing.map((row) => row.number));
          const toCreate = uniqueNumbers.filter((number) => !existingSet.has(number));

          if (toCreate.length > 0) {
            await tx.apartment.createMany({
              data: toCreate.map((number) => ({
                tenantId,
                buildingId: building.id,
                number,
              })),
            });
            apartmentsCreated += toCreate.length;
          }
        }
      }

      return { buildings: createdBuildings, apartmentsCreated };
    });

    return result;
  }

  async bulkCreateApartments(tenantId: string, siteId: string, input: BulkApartmentsInput) {
    await assertBuildingInSite(tenantId, siteId, input.buildingId);

    const building = await prisma.building.findFirst({
      where: { id: input.buildingId, tenantId, siteId },
      select: { id: true, deletedAt: true, isActive: true },
    });
    if (!building || building.deletedAt != null || !building.isActive) {
      throw new HttpError(400, "Silinmiş veya aktif olmayan bir binaya daire eklenemez.");
    }

    const result = await prisma.$transaction(async (tx) => {
      await this.markSetupInProgressTx(tx, tenantId, siteId);

      const existing = await tx.apartment.findMany({
        where: {
          buildingId: input.buildingId,
          deletedAt: null,
          number: { in: input.apartments.map((a) => a.number) },
        },
        select: { number: true },
      });
      const existingSet = new Set(existing.map((row) => row.number));

      const toCreate = input.apartments.filter((a) => !existingSet.has(a.number));
      const skipped = input.apartments.length - toCreate.length;

      if (toCreate.length > 0) {
        await tx.apartment.createMany({
          data: toCreate.map((apartment) => ({
            tenantId,
            buildingId: input.buildingId,
            number: apartment.number,
            floor: apartment.floor ?? null,
            roomType: apartment.roomType ?? null,
          })),
        });
      }

      return { created: toCreate.length, skipped };
    });

    return result;
  }

  async assignResident(tenantId: string, siteId: string, input: AssignResidentInput) {
    await assertApartmentInSite(tenantId, siteId, input.apartmentId);

    const isPrimary = input.isPrimary ?? false;

    const result = await prisma.$transaction(async (tx) => {
      await this.markSetupInProgressTx(tx, tenantId, siteId);

      let person: {
        id: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      };

      if (input.personId) {
        const existing = await tx.person.findFirst({
          where: { id: input.personId, tenantId, deletedAt: null },
          select: personSelect,
        });

        if (!existing) {
          throw new HttpError(404, "Kişi bulunamadı.");
        }

        if (!existing.isActive) {
          throw new HttpError(400, "Pasif kişi daire ilişkisine bağlanamaz.");
        }

        person = existing;
      } else if (input.person) {
        person = await tx.person.create({
          data: {
            tenantId,
            firstName: input.person.firstName,
            lastName: input.person.lastName,
            phone: input.person.phone ?? null,
            email: input.person.email ?? null,
          },
          select: personSelect,
        });
      } else {
        throw new HttpError(400, "Kişi seçilmeli veya yeni kişi bilgisi girilmelidir.");
      }

      if (isPrimary) {
        await tx.apartmentPersonRelation.updateMany({
          where: {
            tenantId,
            apartmentId: input.apartmentId,
            relationType: input.relationType,
            isActive: true,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }

      const relation = await tx.apartmentPersonRelation.create({
        data: {
          tenantId,
          apartmentId: input.apartmentId,
          personId: person.id,
          relationType: input.relationType,
          isPrimary,
          isActive: true,
        },
        select: relationSelect,
      });

      return { person, relation };
    });

    return result;
  }

  async previewImport(tenantId: string, siteId: string, rows: ImportRowInput[]) {
    await this.assertSiteExists(tenantId, siteId);

    const errors: string[] = [];
    const warnings: string[] = [];
    const normalized: NormalizedImportRow[] = [];
    const seenInFile = new Set<string>();

    const buildings = await prisma.building.findMany({
      where: { tenantId, siteId, deletedAt: null },
      select: {
        id: true,
        name: true,
        apartments: {
          where: { deletedAt: null },
          select: { number: true },
        },
      },
    });

    const buildingByName = new Map(
      buildings.map((b) => [b.name.trim().toLowerCase(), b]),
    );

    const phonesToCheck = new Set<string>();
    for (const row of rows) {
      const ownerPhone = normalizeTrPhone(row.ownerPhone);
      const tenantPhone = normalizeTrPhone(row.tenantPhone);
      if (ownerPhone) phonesToCheck.add(ownerPhone);
      if (tenantPhone) phonesToCheck.add(tenantPhone);
    }

    const existingPersons =
      phonesToCheck.size === 0
        ? []
        : await prisma.person.findMany({
            where: {
              tenantId,
              deletedAt: null,
              phone: { in: [...phonesToCheck] },
            },
            select: { id: true, firstName: true, lastName: true, phone: true },
          });

    const personByPhone = new Map(
      existingPersons
        .filter((p) => p.phone)
        .map((p) => [p.phone as string, p]),
    );

    let apartmentCount = 0;
    let ownerCount = 0;
    let tenantCount = 0;

    rows.forEach((row, index) => {
      const line = index + 1;
      const buildingName = row.buildingName.trim();
      const apartmentNumber = row.apartmentNumber.trim();

      if (!buildingName) {
        errors.push(`Satır ${line}: Bina adı boş olamaz.`);
        return;
      }
      if (!apartmentNumber) {
        errors.push(`Satır ${line}: Daire numarası boş olamaz.`);
        return;
      }

      const fileKey = `${buildingName.toLowerCase()}::${apartmentNumber}`;
      if (seenInFile.has(fileKey)) {
        warnings.push(`Satır ${line}: Dosyada tekrar eden daire (${buildingName} / ${apartmentNumber}).`);
      } else {
        seenInFile.add(fileKey);
        apartmentCount += 1;
      }

      const building = buildingByName.get(buildingName.toLowerCase());
      if (building?.apartments.some((a) => a.number === apartmentNumber)) {
        warnings.push(
          `Satır ${line}: Daire zaten kayıtlı (${buildingName} / ${apartmentNumber}).`,
        );
      }

      const ownerPhone = normalizeTrPhone(row.ownerPhone);
      const tenantPhone = normalizeTrPhone(row.tenantPhone);

      if (row.ownerFirstName?.trim() || row.ownerLastName?.trim()) {
        ownerCount += 1;
      }
      if (row.tenantFirstName?.trim() || row.tenantLastName?.trim()) {
        tenantCount += 1;
      }

      if (ownerPhone) {
        const match = personByPhone.get(ownerPhone);
        if (match) {
          warnings.push(
            `Satır ${line}: Mülk sahibi telefonu mevcut kişiyle eşleşiyor (${match.firstName} ${match.lastName}).`,
          );
        }
      }
      if (tenantPhone) {
        const match = personByPhone.get(tenantPhone);
        if (match) {
          warnings.push(
            `Satır ${line}: Kiracı telefonu mevcut kişiyle eşleşiyor (${match.firstName} ${match.lastName}).`,
          );
        }
      }

      normalized.push({
        buildingName,
        apartmentNumber,
        floor: row.floor ?? null,
        roomType: row.roomType ?? null,
        ownerFirstName: row.ownerFirstName?.trim() || undefined,
        ownerLastName: row.ownerLastName?.trim() || undefined,
        ownerPhone,
        tenantFirstName: row.tenantFirstName?.trim() || undefined,
        tenantLastName: row.tenantLastName?.trim() || undefined,
        tenantPhone,
      });
    });

    return {
      apartmentCount,
      ownerCount,
      tenantCount,
      warnings,
      errors,
      rows: normalized,
    };
  }

  async commitImport(tenantId: string, siteId: string, rows: ImportRowInput[]) {
    if (rows.length > 500) {
      throw new HttpError(400, "İçe aktarma en fazla 500 satır destekler.");
    }

    const preview = await this.previewImport(tenantId, siteId, rows);
    if (preview.errors.length > 0) {
      throw new HttpError(400, preview.errors[0]);
    }

    const stats = await prisma.$transaction(async (tx) => {
      await this.markSetupInProgressTx(tx, tenantId, siteId);

      let buildingsCreated = 0;
      let apartmentsCreated = 0;
      let personsCreated = 0;
      let relationsCreated = 0;
      let skippedApartments = 0;

      const buildingCache = new Map<string, string>();
      const apartmentCache = new Map<string, string>();
      const personCache = new Map<string, string>();

      const loadBuildings = await tx.building.findMany({
        where: { tenantId, siteId, deletedAt: null },
        select: { id: true, name: true },
      });
      for (const b of loadBuildings) {
        buildingCache.set(b.name.trim().toLowerCase(), b.id);
      }

      for (const row of preview.rows) {
        const buildingKey = row.buildingName.toLowerCase();
        let buildingId = buildingCache.get(buildingKey);

        if (!buildingId) {
          const created = await tx.building.create({
            data: {
              tenantId,
              siteId,
              name: row.buildingName,
            },
            select: { id: true },
          });
          buildingId = created.id;
          buildingCache.set(buildingKey, buildingId);
          buildingsCreated += 1;
        }

        const apartmentKey = `${buildingId}::${row.apartmentNumber}`;
        let apartmentId = apartmentCache.get(apartmentKey);

        if (!apartmentId) {
          const existing = await tx.apartment.findFirst({
            where: {
              buildingId,
              number: row.apartmentNumber,
              deletedAt: null,
            },
            select: { id: true },
          });

          if (existing) {
            apartmentId = existing.id;
            apartmentCache.set(apartmentKey, apartmentId);
            skippedApartments += 1;
          } else {
            const created = await tx.apartment.create({
              data: {
                tenantId,
                buildingId,
                number: row.apartmentNumber,
                floor: row.floor,
                roomType: row.roomType,
              },
              select: { id: true },
            });
            apartmentId = created.id;
            apartmentCache.set(apartmentKey, apartmentId);
            apartmentsCreated += 1;
          }
        } else {
          skippedApartments += 1;
          continue;
        }

        const ownerResult = await this.resolveAndLinkPersonTx(tx, tenantId, apartmentId, "OWNER", {
          firstName: row.ownerFirstName,
          lastName: row.ownerLastName,
          phone: row.ownerPhone,
        }, personCache);
        personsCreated += ownerResult.personsCreated;
        relationsCreated += ownerResult.relationsCreated;

        const tenantResult = await this.resolveAndLinkPersonTx(tx, tenantId, apartmentId, "TENANT", {
          firstName: row.tenantFirstName,
          lastName: row.tenantLastName,
          phone: row.tenantPhone,
        }, personCache);
        personsCreated += tenantResult.personsCreated;
        relationsCreated += tenantResult.relationsCreated;
      }

      return {
        buildingsCreated,
        apartmentsCreated,
        personsCreated,
        relationsCreated,
        skippedApartments,
      };
    });

    return stats;
  }

  private async resolveAndLinkPersonTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    apartmentId: string,
    relationType: "OWNER" | "TENANT",
    input: { firstName?: string; lastName?: string; phone?: string | null },
    personCache: Map<string, string>,
  ) {
    let personsCreated = 0;
    let relationsCreated = 0;

    const firstName = input.firstName?.trim();
    const lastName = input.lastName?.trim();
    const normalizedPhone = input.phone ? normalizeTrPhone(input.phone) : null;

    if (!firstName && !lastName && !normalizedPhone) {
      return { personsCreated, relationsCreated };
    }

    let personId: string | undefined;

    if (normalizedPhone) {
      personId = personCache.get(normalizedPhone);
      if (!personId) {
        const existing = await tx.person.findFirst({
          where: { tenantId, phone: normalizedPhone, deletedAt: null },
          select: { id: true },
        });
        if (existing) {
          personId = existing.id;
          personCache.set(normalizedPhone, personId);
        }
      }
    }

    if (!personId && firstName && lastName) {
      const created = await tx.person.create({
        data: {
          tenantId,
          firstName,
          lastName,
          phone: normalizedPhone,
        },
        select: { id: true },
      });
      personId = created.id;
      personsCreated += 1;
      if (normalizedPhone) {
        personCache.set(normalizedPhone, personId);
      }
    }

    if (!personId) {
      return { personsCreated, relationsCreated };
    }

    const existingRelation = await tx.apartmentPersonRelation.findFirst({
      where: {
        tenantId,
        apartmentId,
        personId,
        relationType,
        isActive: true,
      },
      select: { id: true },
    });

    if (!existingRelation) {
      await tx.apartmentPersonRelation.create({
        data: {
          tenantId,
          apartmentId,
          personId,
          relationType,
          isActive: true,
        },
      });
      relationsCreated += 1;
    }

    return { personsCreated, relationsCreated };
  }

  /**
   * Sakinler adımı Excel/CSV: mevcut dairelere OWNER/TENANT bağlar.
   * Bina/daire oluşturmaz; apartment matching site scope içindedir.
   */
  async previewResidentsImport(tenantId: string, siteId: string, rows: ResidentImportRowInput[]) {
    await this.assertSiteExists(tenantId, siteId);

    if (rows.length > 500) {
      throw new HttpError(400, "Tek seferde en fazla 500 kayıt aktarabilirsiniz.");
    }

    const apartments = await prisma.apartment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        building: { siteId, tenantId, deletedAt: null },
      },
      select: {
        id: true,
        number: true,
        building: { select: { id: true, name: true } },
        relations: {
          where: { isActive: true, relationType: { in: ["OWNER", "TENANT"] } },
          select: {
            relationType: true,
            person: { select: { id: true, firstName: true, lastName: true, phone: true } },
          },
        },
      },
    });

    const fold = (value: string) => value.trim().toLocaleLowerCase("tr");

    const numberCounts = new Map<string, number>();
    for (const apt of apartments) {
      const key = fold(apt.number);
      numberCounts.set(key, (numberCounts.get(key) ?? 0) + 1);
    }
    const needsBuilding = [...numberCounts.values()].some((count) => count > 1);

    const byNumber = new Map<string, typeof apartments>();
    const byBuildingAndNumber = new Map<string, (typeof apartments)[number]>();
    for (const apt of apartments) {
      const numKey = fold(apt.number);
      const list = byNumber.get(numKey) ?? [];
      list.push(apt);
      byNumber.set(numKey, list);
      byBuildingAndNumber.set(`${fold(apt.building.name)}::${numKey}`, apt);
    }

    const phones = new Set<string>();
    for (const row of rows) {
      const op = normalizeTrPhone(row.ownerPhone);
      const tp = normalizeTrPhone(row.tenantPhone);
      if (op) phones.add(op);
      if (tp) phones.add(tp);
    }

    const existingPersons =
      phones.size === 0
        ? []
        : await prisma.person.findMany({
            where: { tenantId, deletedAt: null, phone: { in: [...phones] } },
            select: { id: true, firstName: true, lastName: true, phone: true },
          });
    const personByPhone = new Map(
      existingPersons.filter((p) => p.phone).map((p) => [p.phone as string, p]),
    );

    const seenKeys = new Map<string, number>();
    const previewRows: Array<{
      line: number;
      buildingName: string | null;
      apartmentNumber: string;
      apartmentId: string | null;
      ownerLabel: string | null;
      tenantLabel: string | null;
      status: "ready" | "warning" | "error" | "skip";
      errors: string[];
      warnings: string[];
      ownerPersonId: string | null;
      tenantPersonId: string | null;
      willReplaceOwner: boolean;
      willReplaceTenant: boolean;
      owner: {
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
      } | null;
      tenant: {
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
      } | null;
    }> = [];

    let ownerCount = 0;
    let tenantCount = 0;
    let matchedCount = 0;
    let readyCount = 0;
    const globalErrors: string[] = [];
    const globalWarnings: string[] = [];

    rows.forEach((row, index) => {
      const line = index + 1;
      const errors: string[] = [];
      const warnings: string[] = [];
      const apartmentNumber = (row.apartmentNumber ?? "").trim();
      const buildingName = row.buildingName?.trim() || "";

      if (!apartmentNumber) {
        errors.push("Daire No boş.");
      }

      let apartment: (typeof apartments)[number] | null = null;
      if (apartmentNumber) {
        if (buildingName) {
          apartment =
            byBuildingAndNumber.get(`${fold(buildingName)}::${fold(apartmentNumber)}`) ?? null;
          if (!apartment) {
            errors.push(`Daire bulunamadı (${buildingName} / ${apartmentNumber}).`);
          }
        } else if (needsBuilding) {
          const matches = byNumber.get(fold(apartmentNumber)) ?? [];
          if (matches.length > 1) {
            errors.push(
              `Daire No ${apartmentNumber} birden fazla binada var; Bina kolonu zorunlu.`,
            );
          } else if (matches.length === 1) {
            apartment = matches[0];
          } else {
            errors.push(`Daire bulunamadı (${apartmentNumber}).`);
          }
        } else {
          const matches = byNumber.get(fold(apartmentNumber)) ?? [];
          if (matches.length === 1) {
            apartment = matches[0];
          } else if (matches.length === 0) {
            errors.push(`Daire bulunamadı (${apartmentNumber}).`);
          } else {
            errors.push(
              `Daire No ${apartmentNumber} birden fazla binada var; Bina kolonu zorunlu.`,
            );
          }
        }
      }

      if (apartment) {
        const fileKey = `${fold(apartment.building.name)}::${fold(apartment.number)}`;
        const prevLine = seenKeys.get(fileKey);
        if (prevLine) {
          errors.push(`Aynı daire dosyada tekrar ediyor (satır ${prevLine}).`);
        } else {
          seenKeys.set(fileKey, line);
        }
        matchedCount += 1;
      }

      const ownerParsed = this.parseResidentPersonFields(
        {
          firstName: row.ownerFirstName,
          lastName: row.ownerLastName,
          phone: row.ownerPhone,
          email: row.ownerEmail,
        },
        "Mülk sahibi",
        errors,
        warnings,
      );
      const tenantParsed = this.parseResidentPersonFields(
        {
          firstName: row.tenantFirstName,
          lastName: row.tenantLastName,
          phone: row.tenantPhone,
          email: row.tenantEmail,
        },
        "Kiracı",
        errors,
        warnings,
      );

      if (!ownerParsed && !tenantParsed && errors.length === 0) {
        warnings.push("Bu satırda sakin bilgisi bulunmuyor.");
      }

      let ownerPersonId: string | null = null;
      let tenantPersonId: string | null = null;

      if (ownerParsed?.phone) {
        const match = personByPhone.get(ownerParsed.phone);
        if (match) {
          ownerPersonId = match.id;
          warnings.push(
            `Mülk sahibi telefonu mevcut kişiyle eşleşiyor (${match.firstName} ${match.lastName}). Mevcut kişi kullanılacak.`,
          );
        }
      }
      if (tenantParsed?.phone) {
        const match = personByPhone.get(tenantParsed.phone);
        if (match) {
          tenantPersonId = match.id;
          warnings.push(
            `Kiracı telefonu mevcut kişiyle eşleşiyor (${match.firstName} ${match.lastName}). Mevcut kişi kullanılacak.`,
          );
        }
      }

      let willReplaceOwner = false;
      let willReplaceTenant = false;
      if (apartment && ownerParsed) {
        const existingOwner = apartment.relations.find((r) => r.relationType === "OWNER");
        if (existingOwner) {
          const samePerson =
            (ownerPersonId && existingOwner.person.id === ownerPersonId) ||
            (ownerParsed.phone &&
              existingOwner.person.phone &&
              existingOwner.person.phone === ownerParsed.phone);
          if (!samePerson) {
            willReplaceOwner = true;
            warnings.push(
              `Dairede mevcut mülk sahibi: ${existingOwner.person.firstName} ${existingOwner.person.lastName}. Değiştirilecek.`,
            );
          }
        }
      }
      if (apartment && tenantParsed) {
        const existingTenant = apartment.relations.find((r) => r.relationType === "TENANT");
        if (existingTenant) {
          const samePerson =
            (tenantPersonId && existingTenant.person.id === tenantPersonId) ||
            (tenantParsed.phone &&
              existingTenant.person.phone &&
              existingTenant.person.phone === tenantParsed.phone);
          if (!samePerson) {
            willReplaceTenant = true;
            warnings.push(
              `Dairede mevcut kiracı: ${existingTenant.person.firstName} ${existingTenant.person.lastName}. Değiştirilecek.`,
            );
          }
        }
      }

      if (ownerParsed) ownerCount += 1;
      if (tenantParsed) tenantCount += 1;

      let status: "ready" | "warning" | "error" | "skip" = "ready";
      if (errors.length > 0) status = "error";
      else if (!ownerParsed && !tenantParsed) status = "skip";
      else if (warnings.length > 0) status = "warning";
      else status = "ready";

      if (status === "ready" || status === "warning") readyCount += 1;

      for (const e of errors) globalErrors.push(`Satır ${line}: ${e}`);
      for (const w of warnings) globalWarnings.push(`Satır ${line}: ${w}`);

      const ownerLabel = ownerParsed
        ? `${ownerParsed.firstName} ${ownerParsed.lastName}`.trim()
        : null;
      const tenantLabel = tenantParsed
        ? `${tenantParsed.firstName} ${tenantParsed.lastName}`.trim()
        : null;

      previewRows.push({
        line,
        buildingName: apartment?.building.name ?? (buildingName || null),
        apartmentNumber,
        apartmentId: apartment?.id ?? null,
        ownerLabel,
        tenantLabel,
        status,
        errors,
        warnings,
        ownerPersonId,
        tenantPersonId,
        willReplaceOwner,
        willReplaceTenant,
        owner: ownerParsed,
        tenant: tenantParsed,
      });
    });

    return {
      needsBuilding,
      rowCount: rows.length,
      matchedApartmentCount: matchedCount,
      ownerCount,
      tenantCount,
      readyCount,
      warningCount: globalWarnings.length,
      errorCount: globalErrors.length,
      errors: globalErrors,
      warnings: globalWarnings,
      rows: previewRows,
    };
  }

  async commitResidentsImport(tenantId: string, siteId: string, rows: ResidentImportRowInput[]) {
    if (rows.length > 500) {
      throw new HttpError(400, "Tek seferde en fazla 500 kayıt aktarabilirsiniz.");
    }

    const preview = await this.previewResidentsImport(tenantId, siteId, rows);
    if (preview.errorCount > 0) {
      throw new HttpError(400, preview.errors[0] ?? "İçe aktarma hatalı satırlar içeriyor.");
    }

    const importable = preview.rows.filter(
      (row) =>
        (row.status === "ready" || row.status === "warning") &&
        row.apartmentId &&
        (row.owner || row.tenant),
    );

    try {
      const stats = await prisma.$transaction(
        async (tx) => {
          await this.markSetupInProgressTx(tx, tenantId, siteId);

          let personsCreated = 0;
          let ownersLinked = 0;
          let tenantsLinked = 0;
          let relationsReplaced = 0;
          let skippedRows = 0;

          const personCache = new Map<string, string>();

          for (const row of importable) {
            if (!row.apartmentId) {
              skippedRows += 1;
              continue;
            }

            if (row.owner) {
              const result = await this.linkResidentImportTx(
                tx,
                tenantId,
                row.apartmentId,
                "OWNER",
                row.owner,
                personCache,
                row.ownerPersonId,
                row.willReplaceOwner,
              );
              personsCreated += result.personsCreated;
              ownersLinked += result.linked ? 1 : 0;
              relationsReplaced += result.replaced ? 1 : 0;
            }

            if (row.tenant) {
              const result = await this.linkResidentImportTx(
                tx,
                tenantId,
                row.apartmentId,
                "TENANT",
                row.tenant,
                personCache,
                row.tenantPersonId,
                row.willReplaceTenant,
              );
              personsCreated += result.personsCreated;
              tenantsLinked += result.linked ? 1 : 0;
              relationsReplaced += result.replaced ? 1 : 0;
            }
          }

          skippedRows += preview.rows.filter((r) => r.status === "skip").length;

          return {
            personsCreated,
            ownersLinked,
            tenantsLinked,
            relationsReplaced,
            skippedRows,
            importedRows: importable.length,
          };
        },
        {
          // Toplu sakin aktarımında satır başına birden fazla sorgu var; varsayılan 5sn yetmeyebilir.
          maxWait: 20_000,
          timeout: 120_000,
        },
      );

      return stats;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2028") {
          throw new HttpError(
            504,
            "Sakin aktarımı zaman aşımına uğradı. Daha az satırla tekrar deneyin.",
          );
        }
        throw new HttpError(500, `Sakin aktarımı veritabanı hatası (${error.code}).`);
      }
      throw error;
    }
  }

  private parseResidentPersonFields(
    input: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      email?: string;
    },
    label: string,
    errors: string[],
    warnings: string[],
  ): {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
  } | null {
    const firstName = input.firstName?.trim() ?? "";
    const lastName = input.lastName?.trim() ?? "";
    const phoneRaw = input.phone?.trim() ?? "";
    const emailRaw = input.email?.trim() ?? "";

    const any =
      Boolean(firstName) || Boolean(lastName) || Boolean(phoneRaw) || Boolean(emailRaw);
    if (!any) return null;

    if (firstName && !lastName) {
      errors.push(`${label}: soyad zorunludur.`);
      return null;
    }
    if (lastName && !firstName) {
      errors.push(`${label}: ad zorunludur.`);
      return null;
    }
    if (!firstName || !lastName) {
      errors.push(`${label}: ad ve soyad zorunludur.`);
      return null;
    }

    let phone: string | null = null;
    if (phoneRaw) {
      phone = normalizeTrPhone(phoneRaw);
      if (!phone) {
        errors.push(`${label}: telefon formatı okunamadı.`);
        return null;
      }
    } else {
      warnings.push(`${label}: telefon boş.`);
    }

    let email: string | null = null;
    if (emailRaw) {
      email = emailRaw.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`${label}: e-posta formatı hatalı.`);
        return null;
      }
    }

    return { firstName, lastName, phone, email };
  }

  private async linkResidentImportTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    apartmentId: string,
    relationType: "OWNER" | "TENANT",
    personInput: {
      firstName: string;
      lastName: string;
      phone: string | null;
      email: string | null;
    },
    personCache: Map<string, string>,
    suggestedPersonId: string | null,
    willReplace: boolean,
  ) {
    let personsCreated = 0;
    let personId = suggestedPersonId ?? undefined;

    if (personInput.phone) {
      const cached = personCache.get(personInput.phone);
      if (cached) personId = cached;
    }

    if (!personId && personInput.phone) {
      const existing = await tx.person.findFirst({
        where: { tenantId, phone: personInput.phone, deletedAt: null },
        select: { id: true },
      });
      if (existing) personId = existing.id;
    }

    if (!personId) {
      const created = await tx.person.create({
        data: {
          tenantId,
          firstName: personInput.firstName,
          lastName: personInput.lastName,
          phone: personInput.phone,
          email: personInput.email,
        },
        select: { id: true },
      });
      personId = created.id;
      personsCreated += 1;
    }

    if (personInput.phone) {
      personCache.set(personInput.phone, personId);
    }

    const existingSame = await tx.apartmentPersonRelation.findFirst({
      where: {
        tenantId,
        apartmentId,
        personId,
        relationType,
        isActive: true,
      },
      select: { id: true },
    });

    if (existingSame) {
      return { personsCreated, linked: false, replaced: false };
    }

    let replaced = false;
    if (willReplace) {
      const ended = await tx.apartmentPersonRelation.updateMany({
        where: {
          tenantId,
          apartmentId,
          relationType,
          isActive: true,
        },
        data: {
          isActive: false,
          endDate: new Date(),
        },
      });
      replaced = ended.count > 0;
    } else {
      // Aynı tipte başka aktif ilişki varsa da soft-end (güvenlik)
      const otherActive = await tx.apartmentPersonRelation.findFirst({
        where: {
          tenantId,
          apartmentId,
          relationType,
          isActive: true,
          NOT: { personId },
        },
        select: { id: true },
      });
      if (otherActive) {
        await tx.apartmentPersonRelation.updateMany({
          where: {
            tenantId,
            apartmentId,
            relationType,
            isActive: true,
            NOT: { personId },
          },
          data: { isActive: false, endDate: new Date() },
        });
        replaced = true;
      }
    }

    await tx.apartmentPersonRelation.create({
      data: {
        tenantId,
        apartmentId,
        personId,
        relationType,
        isActive: true,
        isPrimary: false,
      },
    });

    return { personsCreated, linked: true, replaced };
  }

  private async assertSiteExists(tenantId: string, siteId: string) {
    const site = await prisma.site.findFirst({
      where: { id: siteId, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!site) {
      throw new HttpError(404, "Site bulunamadı.");
    }
  }

  private async markSetupInProgressTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
  ) {
    await tx.site.updateMany({
      where: {
        id: siteId,
        tenantId,
        deletedAt: null,
        setupStatus: "NOT_STARTED",
      },
      data: {
        setupStatus: "IN_PROGRESS",
        setupCompletedAt: null,
      },
    });
  }
}

export const siteSetupService = new SiteSetupService();
