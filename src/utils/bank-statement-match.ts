import { prisma } from "../lib/prisma";
import { bankTextContains, normalizeBankText } from "./bank-text";

export type StatementMatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type StatementMatchSuggestion = {
  apartmentId: string | null;
  personId: string | null;
  buildingId: string | null;
  matchStatus: "UNMATCHED" | "SUGGESTED";
  confidence: StatementMatchConfidence;
  reason: string;
  candidateCount: number;
};

type PersonHit = {
  personId: string;
  apartmentId: string;
  buildingId: string;
  fullName: string;
};

function extractApartmentHints(description: string): string[] {
  const text = description.toLocaleLowerCase("tr-TR");
  const hints = new Set<string>();
  const patterns = [
    /\bdaire\s*[#:.]?\s*([a-z0-9\-]+)/gi,
    /\bno\s*[#:.]?\s*([a-z0-9\-]+)/gi,
    /\bn[oö]\s*[#:.]?\s*([a-z0-9\-]+)/gi,
    /\b([0-9]{1,4}[a-z]?)\s*nolu\b/gi,
    /\bblok\s*[a-z0-9]+\s+([0-9]{1,4}[a-z]?)\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) != null) {
      if (match[1]) hints.add(match[1].toUpperCase());
    }
  }
  return [...hints];
}

/** Blok + daire birlikte geçiyorsa (ör. "B Blok Daire 12") yapılandırılmış adaylar. */
function extractBlockApartmentPairs(description: string): Array<{ block: string; number: string }> {
  const text = description.toLocaleLowerCase("tr-TR");
  const pairs: Array<{ block: string; number: string }> = [];
  const patterns = [
    /\b([a-z0-9]+)\s*blok\s*(?:daire\s*)?[#:.]?\s*([0-9]{1,4}[a-z]?)\b/gi,
    /\bblok\s*([a-z0-9]+)\s*(?:daire\s*)?[#:.]?\s*([0-9]{1,4}[a-z]?)\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) != null) {
      if (match[1] && match[2]) {
        pairs.push({
          block: normalizeBankText(match[1]),
          number: normalizeBankText(match[2]),
        });
      }
    }
  }
  return pairs;
}

export async function suggestStatementMatch(
  tenantId: string,
  siteId: string,
  bankAccountId: string,
  description: string,
): Promise<StatementMatchSuggestion> {
  const rules = await prisma.bankMatchingRule.findMany({
    where: {
      tenantId,
      siteId,
      deletedAt: null,
      isActive: true,
      OR: [{ bankAccountId }, { bankAccountId: null }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      containsText: true,
      apartmentId: true,
      personId: true,
      buildingId: true,
    },
  });

  const ruleHits = rules.filter((rule) => bankTextContains(description, rule.containsText));
  const ruleApartmentIds = new Set(ruleHits.map((h) => h.apartmentId).filter(Boolean) as string[]);
  if (ruleApartmentIds.size === 1) {
    const best = ruleHits.find((h) => h.apartmentId)!;
    return {
      apartmentId: best.apartmentId,
      personId: best.personId,
      buildingId: best.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "HIGH",
      reason: "Kayıtlı eşleştirme kuralı",
      candidateCount: 1,
    };
  }
  if (ruleApartmentIds.size > 1) {
    return {
      apartmentId: null,
      personId: null,
      buildingId: null,
      matchStatus: "UNMATCHED",
      confidence: "NONE",
      reason: "Birden fazla kural adayı",
      candidateCount: ruleApartmentIds.size,
    };
  }

  const apartments = await prisma.apartment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      building: { siteId, deletedAt: null, isActive: true },
    },
    select: {
      id: true,
      number: true,
      buildingId: true,
      building: { select: { name: true } },
    },
  });

  const blockPairs = extractBlockApartmentPairs(description);
  if (blockPairs.length > 0) {
    const pairHits = apartments.filter((apt) => {
      const buildingNorm = normalizeBankText(apt.building.name);
      const numberNorm = normalizeBankText(apt.number);
      return blockPairs.some(
        (pair) =>
          numberNorm === pair.number &&
          (buildingNorm.includes(pair.block) || buildingNorm.startsWith(pair.block)),
      );
    });
    if (pairHits.length === 1) {
      return {
        apartmentId: pairHits[0]!.id,
        personId: null,
        buildingId: pairHits[0]!.buildingId,
        matchStatus: "SUGGESTED",
        confidence: "HIGH",
        reason: "Blok + daire numarası",
        candidateCount: 1,
      };
    }
    if (pairHits.length > 1) {
      return {
        apartmentId: null,
        personId: null,
        buildingId: null,
        matchStatus: "UNMATCHED",
        confidence: "NONE",
        reason: "Birden fazla daire adayı",
        candidateCount: pairHits.length,
      };
    }
  }

  const hints = extractApartmentHints(description);
  if (hints.length > 0) {
    const aptHits = apartments.filter((apt) =>
      hints.some(
        (hint) =>
          normalizeBankText(apt.number) === normalizeBankText(hint) ||
          normalizeBankText(`${apt.building.name} ${apt.number}`).includes(normalizeBankText(hint)),
      ),
    );
    if (aptHits.length === 1) {
      return {
        apartmentId: aptHits[0]!.id,
        personId: null,
        buildingId: aptHits[0]!.buildingId,
        matchStatus: "SUGGESTED",
        confidence: "HIGH",
        reason: "Blok/daire numarası",
        candidateCount: 1,
      };
    }
    if (aptHits.length > 1) {
      return {
        apartmentId: null,
        personId: null,
        buildingId: null,
        matchStatus: "UNMATCHED",
        confidence: "NONE",
        reason: "Birden fazla daire adayı",
        candidateCount: aptHits.length,
      };
    }
  }

  const relations = await prisma.apartmentPersonRelation.findMany({
    where: {
      tenantId,
      isActive: true,
      relationType: { in: ["OWNER", "TENANT"] },
      apartment: {
        deletedAt: null,
        isActive: true,
        building: { siteId, deletedAt: null },
      },
      person: { deletedAt: null, isActive: true },
    },
    select: {
      personId: true,
      apartmentId: true,
      apartment: { select: { buildingId: true } },
      person: { select: { firstName: true, lastName: true } },
    },
  });

  const personHits: PersonHit[] = [];
  for (const rel of relations) {
    const fullName = `${rel.person.firstName} ${rel.person.lastName}`.trim();
    if (fullName.replace(/\s+/g, "").length < 4) continue;
    if (bankTextContains(description, fullName)) {
      personHits.push({
        personId: rel.personId,
        apartmentId: rel.apartmentId,
        buildingId: rel.apartment.buildingId,
        fullName,
      });
    }
  }

  const uniqueApartments = new Set(personHits.map((h) => h.apartmentId));
  if (uniqueApartments.size === 1) {
    const best = personHits[0]!;
    return {
      apartmentId: best.apartmentId,
      personId: best.personId,
      buildingId: best.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "MEDIUM",
      reason: "Benzersiz ad-soyad",
      candidateCount: 1,
    };
  }
  if (uniqueApartments.size > 1) {
    return {
      apartmentId: null,
      personId: null,
      buildingId: null,
      matchStatus: "UNMATCHED",
      confidence: "NONE",
      reason: "Birden fazla kişi/daire adayı",
      candidateCount: uniqueApartments.size,
    };
  }

  return {
    apartmentId: null,
    personId: null,
    buildingId: null,
    matchStatus: "UNMATCHED",
    confidence: "NONE",
    reason: "Eşleşme bulunamadı",
    candidateCount: 0,
  };
}
