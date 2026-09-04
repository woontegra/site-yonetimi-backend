import { prisma } from "../lib/prisma";
import { bankTextContains, normalizeBankText } from "./bank-text";

export type StatementMatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type StatementMatchKind =
  | "RULE"
  | "FULL_NAME_OWNER"
  | "FULL_NAME_TENANT"
  | "NAME_AND_APARTMENT"
  | "BLOCK_AND_APARTMENT"
  | "APARTMENT_NUMBER_ONLY"
  | "PARTIAL_NAME"
  | "SURNAME_ONLY"
  | "INITIALS_NAME"
  | "NAME_MISMATCH_APARTMENT"
  | "NONE";

export type StatementMatchSuggestion = {
  apartmentId: string | null;
  personId: string | null;
  buildingId: string | null;
  matchStatus: "UNMATCHED" | "SUGGESTED";
  confidence: StatementMatchConfidence;
  reason: string;
  candidateCount: number;
  /** Kullanıcı dilinde gerekçe (reason ile aynı; FE alan adı). */
  matchReason: string;
  matchKind: StatementMatchKind;
  matchedPersonRole: "OWNER" | "TENANT" | null;
  matchedPersonName: string | null;
  nameMismatch: boolean;
};

type PersonHit = {
  personId: string;
  apartmentId: string;
  buildingId: string;
  fullName: string;
  relationType: "OWNER" | "TENANT";
};

type MatchRule = {
  containsText: string;
  apartmentId: string | null;
  personId: string | null;
  buildingId: string | null;
};

type MatchApartment = {
  id: string;
  number: string;
  buildingId: string;
  building: { name: string };
};

type MatchRelation = {
  personId: string;
  apartmentId: string;
  relationType: "OWNER" | "TENANT";
  apartment: { buildingId: string };
  person: { firstName: string; lastName: string };
};

export type StatementMatchContext = {
  rules: MatchRule[];
  apartments: MatchApartment[];
  relations: MatchRelation[];
};

type NameMatchQuality = "FULL" | "INITIALS" | "PARTIAL" | "SURNAME" | "NONE";

function roleLabel(role: "OWNER" | "TENANT"): string {
  return role === "OWNER" ? "malik" : "kiracı";
}

function suggestion(
  partial: Omit<StatementMatchSuggestion, "matchReason"> & { matchReason?: string },
): StatementMatchSuggestion {
  const reason = partial.reason;
  return {
    ...partial,
    matchReason: partial.matchReason ?? reason,
  };
}

/** Exact apartment numbers only — never substring ("6" must not hit "16"). */
export function extractApartmentNumberCandidates(description: string): string[] {
  const text = description.toLocaleLowerCase("tr-TR");
  const hints = new Set<string>();
  const patterns = [
    /\bdaire\s*[#:.]?\s*(\d{1,4}[a-z]?)\b/gi,
    /\bno\s*[#:.]?\s*(\d{1,4}[a-z]?)\b/gi,
    /\bn[oö]\s*[#:.]?\s*(\d{1,4}[a-z]?)\b/gi,
    /\b(\d{1,4}[a-z]?)\s*nolu\b/gi,
    /\bblok\s*[a-z0-9]+\s+(?:daire\s*)?[#:.]?\s*(\d{1,4}[a-z]?)\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = pattern.exec(text)) != null) {
      guard += 1;
      if (guard > 50) break;
      if (match[1]) hints.add(normalizeBankText(match[1]));
    }
  }
  return [...hints];
}

/** @deprecated use extractApartmentNumberCandidates */
export function extractApartmentHints(description: string): string[] {
  return extractApartmentNumberCandidates(description);
}

export function extractBlockApartmentPairs(
  description: string,
): Array<{ block: string; number: string }> {
  const text = description.toLocaleLowerCase("tr-TR");
  const pairs: Array<{ block: string; number: string }> = [];
  const patterns = [
    /\b([a-z0-9]+)\s*blok\s*(?:daire\s*)?[#:.]?\s*([0-9]{1,4}[a-z]?)\b/gi,
    /\bblok\s*([a-z0-9]+)\s*(?:daire\s*)?[#:.]?\s*([0-9]{1,4}[a-z]?)\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = pattern.exec(text)) != null) {
      guard += 1;
      if (guard > 50) break;
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

export function extractPersonNameCandidates(description: string): string[] {
  const names = new Set<string>();
  const cleaned = description
    .replace(/-?\d{1,2}:\d{2}(?::\d{2})?/g, " ")
    .replace(/\b(sistem|system|fa|fast|eft|havale|gelen|giden|sube|şube)\b/gi, " ")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const nameChunkRe =
    /([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü.'\-]+(?:\s+[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü.'\-]+){1,3})/i;

  const labeled =
    cleaned.match(
      /(?:gönderen|gonderen|alıcı|alici)\s*[:.\-]?\s*([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü.'\-]+(?:\s+[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü.'\-]+){1,2})/i,
    ) ?? null;
  if (labeled?.[1]) names.add(labeled[1].trim());

  const starParts = description.split("*").map((p) => p.trim()).filter(Boolean);
  for (const part of starParts) {
    const withoutNoise = part
      .replace(/-?\d{1,2}:\d{2}(?::\d{2})?/g, " ")
      .replace(/\b(sistem|system|fa|fast|eft|havale|gelen|giden)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const m = withoutNoise.match(nameChunkRe);
    if (m?.[1] && !/\bdaire\b/i.test(m[1])) names.add(m[1].trim());
  }

  // cleaned zaten kanal kelimelerini siler — baştaki kişi adayı
  const leading = cleaned.match(nameChunkRe);
  if (leading?.[1] && !/\bdaire\b/i.test(leading[1])) names.add(leading[1].trim());

  // Ham metinde kanal sonrası (cleaned'de FAST yok)
  const afterChannel = description.match(
    /(?:\be9\b|\beft\b|\bhavale\b|\bfast\b)\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü.'\-]+(?:\s+[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü.'\-]+){1,3})/i,
  );
  if (afterChannel?.[1] && !/\bdaire\b/i.test(afterChannel[1])) {
    names.add(afterChannel[1].trim());
  }

  return [...names]
    .map((n) =>
      n
        .split(/\s+/)
        .filter(
          (w) =>
            !/^(aidat|aidati|odeme|ödeme|daire|blok|ref|eylul|ekim|kasim|aralik|ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|ağustos|tl|try|no)$/i.test(
              w,
            ),
        )
        .join(" ")
        .trim(),
    )
    .filter((n) => {
      const words = n.split(/\s+/).filter(Boolean);
      return words.length >= 2 && normalizeBankText(n).replace(/\s/g, "").length >= 5;
    });
}

function apartmentsByExactNumber(
  apartments: MatchApartment[],
  number: string,
): MatchApartment[] {
  const want = normalizeBankText(number);
  const hits = apartments.filter((apt) => normalizeBankText(apt.number) === want);
  const seen = new Set<string>();
  return hits.filter((apt) => {
    if (seen.has(apt.id)) return false;
    seen.add(apt.id);
    return true;
  });
}

function tokensOf(name: string): string[] {
  return normalizeBankText(name)
    .split(/\s+/)
    .map((t) => t.replace(/\./g, ""))
    .filter((t) => t.length > 0);
}

/**
 * FULL: tüm ad-soyad tokenleri birebir (sıra korunarak veya tam string).
 * INITIALS: "M Sinan Erkan" ↔ "Mehmet Sinan Erkan" / "M. Sinan Erkan"
 * PARTIAL: ad+soyad adayının tüm tokenleri kayıtlı isimde var (fazladan orta ad olabilir)
 * SURNAME: yalnız soyadı ortak (tek token overlap last)
 */
export function classifyNameMatch(registeredName: string, candidate: string): NameMatchQuality {
  const a = normalizeBankText(registeredName);
  const b = normalizeBankText(candidate);
  if (!a || !b) return "NONE";
  if (a === b) return "FULL";

  const at = tokensOf(registeredName);
  const bt = tokensOf(candidate);
  if (at.length < 2 || bt.length < 1) return "NONE";

  if (at.length === bt.length && at.every((t, i) => t === bt[i])) return "FULL";

  // Initials: first token(s) single-letter match, last + remaining full
  if (at.length >= 2 && bt.length >= 2) {
    const lastA = at[at.length - 1]!;
    const lastB = bt[bt.length - 1]!;
    if (lastA === lastB) {
      const headA = at.slice(0, -1);
      const headB = bt.slice(0, -1);
      if (headA.length === headB.length) {
        const initialsOk = headA.every((tok, i) => {
          const other = headB[i]!;
          if (tok === other) return true;
          if (tok.length === 1 && other.startsWith(tok)) return true;
          if (other.length === 1 && tok.startsWith(other)) return true;
          return false;
        });
        if (initialsOk) {
          const anyInitial = headA.some((tok, i) => tok !== headB[i] && (tok.length === 1 || headB[i]!.length === 1));
          return anyInitial ? "INITIALS" : "FULL";
        }
      }
    }
  }

  // Partial: all candidate tokens appear in registered (order-insensitive)
  if (bt.length >= 2 && bt.every((t) => at.includes(t))) return "PARTIAL";
  if (at.length >= 2 && at.every((t) => bt.includes(t))) return "PARTIAL";

  // Surname only
  const lastA = at[at.length - 1]!;
  const lastB = bt[bt.length - 1]!;
  if (lastA.length >= 3 && lastA === lastB) {
    const firstOverlap = at.slice(0, -1).some((t) => bt.slice(0, -1).includes(t));
    if (!firstOverlap) return "SURNAME";
  }

  // Loose contains (avoid short surname false positives)
  if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) return "PARTIAL";

  return "NONE";
}

function bestNameQualityAgainstDescription(
  fullName: string,
  nameCandidates: string[],
  description: string,
): NameMatchQuality {
  let best: NameMatchQuality = "NONE";
  const rank = (q: NameMatchQuality) =>
    q === "FULL" ? 4 : q === "INITIALS" ? 3 : q === "PARTIAL" ? 2 : q === "SURNAME" ? 1 : 0;

  if (bankTextContains(description, fullName)) {
    best = "FULL";
  }
  for (const c of nameCandidates) {
    const q = classifyNameMatch(fullName, c);
    if (rank(q) > rank(best)) best = q;
  }
  // Also try whole description as haystack for full name containment already handled
  return best;
}

export async function loadStatementMatchContext(
  tenantId: string,
  siteId: string,
  bankAccountId: string,
): Promise<StatementMatchContext> {
  const [rules, apartments, relations] = await Promise.all([
    prisma.bankMatchingRule.findMany({
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
    }),
    prisma.apartment.findMany({
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
    }),
    prisma.apartmentPersonRelation.findMany({
      where: {
        tenantId,
        isActive: true,
        relationType: { in: ["OWNER", "TENANT"] },
        apartment: {
          deletedAt: null,
          isActive: true,
          building: { siteId, deletedAt: null, isActive: true },
        },
        person: { deletedAt: null, isActive: true },
      },
      select: {
        personId: true,
        apartmentId: true,
        relationType: true,
        apartment: { select: { buildingId: true } },
        person: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return {
    rules,
    apartments,
    relations: relations.map((r) => ({
      ...r,
      relationType: r.relationType as "OWNER" | "TENANT",
    })),
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function pickBestPersonOnApartment(
  ctx: StatementMatchContext,
  apartmentId: string,
  nameCandidates: string[],
  description: string,
  minQuality: NameMatchQuality = "SURNAME",
): { hit: PersonHit; quality: NameMatchQuality } | null {
  const rank = (q: NameMatchQuality) =>
    q === "FULL" ? 4 : q === "INITIALS" ? 3 : q === "PARTIAL" ? 2 : q === "SURNAME" ? 1 : 0;
  const minRank = rank(minQuality);
  let best: { hit: PersonHit; quality: NameMatchQuality } | null = null;

  for (const rel of ctx.relations) {
    if (rel.apartmentId !== apartmentId) continue;
    const fullName = `${rel.person.firstName} ${rel.person.lastName}`.trim();
    const quality = bestNameQualityAgainstDescription(fullName, nameCandidates, description);
    if (rank(quality) < minRank) continue;
    if (!best || rank(quality) > rank(best.quality)) {
      best = {
        hit: {
          personId: rel.personId,
          apartmentId: rel.apartmentId,
          buildingId: rel.apartment.buildingId,
          fullName,
          relationType: rel.relationType,
        },
        quality,
      };
    }
  }
  return best;
}

function reasonForFullName(role: "OWNER" | "TENANT"): string {
  return role === "OWNER"
    ? "Gönderen adı ile malik adı tam eşleşti."
    : "Gönderen adı ile kiracı adı tam eşleşti.";
}

export function suggestStatementMatchFromContext(
  ctx: StatementMatchContext,
  description: string,
): StatementMatchSuggestion {
  const empty = (reason: string, candidateCount = 0): StatementMatchSuggestion =>
    suggestion({
      apartmentId: null,
      personId: null,
      buildingId: null,
      matchStatus: "UNMATCHED",
      confidence: "NONE",
      reason,
      candidateCount,
      matchKind: "NONE",
      matchedPersonRole: null,
      matchedPersonName: null,
      nameMismatch: false,
    });

  // 1) Saved rules → HIGH
  const ruleHits = ctx.rules.filter((rule) => bankTextContains(description, rule.containsText));
  const ruleApartmentIds = new Set(ruleHits.map((h) => h.apartmentId).filter(Boolean) as string[]);
  if (ruleApartmentIds.size === 1) {
    const best = ruleHits.find((h) => h.apartmentId)!;
    return suggestion({
      apartmentId: best.apartmentId,
      personId: best.personId,
      buildingId: best.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "HIGH",
      reason: "Daha önce onaylanan gönderen kuralıyla eşleşti.",
      candidateCount: 1,
      matchKind: "RULE",
      matchedPersonRole: null,
      matchedPersonName: null,
      nameMismatch: false,
    });
  }
  if (ruleApartmentIds.size > 1) {
    return empty("Birden fazla kural adayı", ruleApartmentIds.size);
  }

  const nameCandidates = extractPersonNameCandidates(description);
  const numberCandidates = extractApartmentNumberCandidates(description);

  // 2) Block + apartment
  const blockPairs = extractBlockApartmentPairs(description);
  if (blockPairs.length > 0) {
    const pairHits = ctx.apartments.filter((apt) => {
      const buildingNorm = normalizeBankText(apt.building.name);
      const numberNorm = normalizeBankText(apt.number);
      return blockPairs.some(
        (pair) =>
          numberNorm === pair.number &&
          (buildingNorm.includes(pair.block) || buildingNorm.startsWith(pair.block)),
      );
    });
    const unique = uniqueById(pairHits);
    if (unique.length === 1) {
      const person = pickBestPersonOnApartment(ctx, unique[0]!.id, nameCandidates, description, "PARTIAL");
      if (person && (person.quality === "FULL" || person.quality === "INITIALS")) {
        return suggestion({
          apartmentId: unique[0]!.id,
          personId: person.hit.personId,
          buildingId: unique[0]!.buildingId,
          matchStatus: "SUGGESTED",
          confidence: "HIGH",
          reason: "Gönderen adı ve daire numarası birlikte eşleşti.",
          candidateCount: 1,
          matchKind: "NAME_AND_APARTMENT",
          matchedPersonRole: person.hit.relationType,
          matchedPersonName: person.hit.fullName,
          nameMismatch: false,
        });
      }
      // Block+apt without strong person → MEDIUM (not HIGH alone)
      return suggestion({
        apartmentId: unique[0]!.id,
        personId: person?.hit.personId ?? null,
        buildingId: unique[0]!.buildingId,
        matchStatus: "SUGGESTED",
        confidence: "MEDIUM",
        reason: `Açıklamadaki bina + daire numarası eşleşti${
          person ? `; kayıtlı ${roleLabel(person.hit.relationType)}: ${person.hit.fullName}` : ""
        }.`,
        candidateCount: 1,
        matchKind: "BLOCK_AND_APARTMENT",
        matchedPersonRole: person?.hit.relationType ?? null,
        matchedPersonName: person?.hit.fullName ?? null,
        nameMismatch: Boolean(nameCandidates.length && !person),
      });
    }
    if (unique.length > 1) {
      return empty("Birden fazla daire adayı", unique.length);
    }
  }

  // 3) Apartment number + person name together → HIGH
  if (numberCandidates.length > 0 && nameCandidates.length > 0) {
    for (const number of numberCandidates) {
      const apts = apartmentsByExactNumber(ctx.apartments, number);
      if (apts.length !== 1) continue;
      const apt = apts[0]!;
      const person = pickBestPersonOnApartment(ctx, apt.id, nameCandidates, description, "PARTIAL");
      if (person && (person.quality === "FULL" || person.quality === "INITIALS" || person.quality === "PARTIAL")) {
        return suggestion({
          apartmentId: apt.id,
          personId: person.hit.personId,
          buildingId: apt.buildingId,
          matchStatus: "SUGGESTED",
          confidence: person.quality === "PARTIAL" ? "MEDIUM" : "HIGH",
          reason:
            person.quality === "PARTIAL"
              ? "Gönderen adı kısmi eşleşti ve daire numarası uyuştu."
              : "Gönderen adı ve daire numarası birlikte eşleşti.",
          candidateCount: 1,
          matchKind: "NAME_AND_APARTMENT",
          matchedPersonRole: person.hit.relationType,
          matchedPersonName: person.hit.fullName,
          nameMismatch: false,
        });
      }
    }
  }

  // 3b) Exact unique apartment number — if sender name does NOT match people → MEDIUM + nameMismatch
  if (numberCandidates.length === 1) {
    const number = numberCandidates[0]!;
    const apts = apartmentsByExactNumber(ctx.apartments, number);
    if (apts.length === 1) {
      const apt = apts[0]!;
      const person = pickBestPersonOnApartment(ctx, apt.id, nameCandidates, description, "SURNAME");
      const strong =
        person &&
        (person.quality === "FULL" || person.quality === "INITIALS" || person.quality === "PARTIAL");

      if (strong && person) {
        return suggestion({
          apartmentId: apt.id,
          personId: person.hit.personId,
          buildingId: apt.buildingId,
          matchStatus: "SUGGESTED",
          confidence: person.quality === "PARTIAL" || person.quality === "INITIALS" ? "MEDIUM" : "HIGH",
          reason:
            person.quality === "FULL"
              ? "Gönderen adı ve daire numarası birlikte eşleşti."
              : person.quality === "INITIALS"
                ? "Gönderen adı kısaltması ile kayıtlı kişi ve daire numarası uyuştu."
                : "Gönderen adı kısmi eşleşti ve daire numarası uyuştu.",
          candidateCount: 1,
          matchKind: "NAME_AND_APARTMENT",
          matchedPersonRole: person.hit.relationType,
          matchedPersonName: person.hit.fullName,
          nameMismatch: false,
        });
      }

      // Number only OR surname-only on that apt with name present → MEDIUM, name mismatch if names exist
      const hasSenderName = nameCandidates.length > 0;
      const primary = ctx.relations.find((r) => r.apartmentId === apt.id);
      const primaryName = primary
        ? `${primary.person.firstName} ${primary.person.lastName}`.trim()
        : null;
      const primaryRole = (primary?.relationType as "OWNER" | "TENANT" | undefined) ?? null;

      return suggestion({
        apartmentId: apt.id,
        personId: person?.hit.personId ?? primary?.personId ?? null,
        buildingId: apt.buildingId,
        matchStatus: "SUGGESTED",
        confidence: "MEDIUM",
        reason: hasSenderName
          ? `Açıklamadaki ‘${number}’ numarası Daire ${apt.number} olarak yorumlandı; gönderen adı kayıtlı kişiyle uyuşmuyor.`
          : `Açıklamadaki ‘Daire ${apt.number}’ bilgisiyle eşleşti.`,
        candidateCount: 1,
        matchKind: hasSenderName ? "NAME_MISMATCH_APARTMENT" : "APARTMENT_NUMBER_ONLY",
        matchedPersonRole: person?.hit.relationType ?? primaryRole,
        matchedPersonName: person?.hit.fullName ?? primaryName,
        nameMismatch: hasSenderName,
      });
    }
    if (apts.length > 1) {
      if (nameCandidates.length > 0) {
        const narrowed: Array<{ apt: MatchApartment; person: NonNullable<ReturnType<typeof pickBestPersonOnApartment>> }> =
          [];
        for (const apt of apts) {
          const person = pickBestPersonOnApartment(ctx, apt.id, nameCandidates, description, "PARTIAL");
          if (person && person.quality !== "SURNAME") narrowed.push({ apt, person });
        }
        if (narrowed.length === 1) {
          const { apt, person } = narrowed[0]!;
          return suggestion({
            apartmentId: apt.id,
            personId: person.hit.personId,
            buildingId: apt.buildingId,
            matchStatus: "SUGGESTED",
            confidence: person.quality === "FULL" ? "HIGH" : "MEDIUM",
            reason: "Gönderen adı ve daire numarası birlikte eşleşti.",
            candidateCount: 1,
            matchKind: "NAME_AND_APARTMENT",
            matchedPersonRole: person.hit.relationType,
            matchedPersonName: person.hit.fullName,
            nameMismatch: false,
          });
        }
      }
      return empty("Birden fazla daire adayı", apts.length);
    }
  }

  // 4) Unique full / initials / partial person name in site
  type Scored = { hit: PersonHit; quality: NameMatchQuality };
  const scored: Scored[] = [];
  const seenApt = new Set<string>();

  for (const rel of ctx.relations) {
    const fullName = `${rel.person.firstName} ${rel.person.lastName}`.trim();
    if (fullName.replace(/\s+/g, "").length < 4) continue;
    const quality = bestNameQualityAgainstDescription(fullName, nameCandidates, description);
    if (quality === "NONE") continue;
    if (seenApt.has(rel.apartmentId) && quality !== "FULL") continue;
    // Prefer best quality per apartment
    const existing = scored.find((s) => s.hit.apartmentId === rel.apartmentId);
    const rank = (q: NameMatchQuality) =>
      q === "FULL" ? 4 : q === "INITIALS" ? 3 : q === "PARTIAL" ? 2 : q === "SURNAME" ? 1 : 0;
    if (existing) {
      if (rank(quality) > rank(existing.quality)) {
        existing.quality = quality;
        existing.hit = {
          personId: rel.personId,
          apartmentId: rel.apartmentId,
          buildingId: rel.apartment.buildingId,
          fullName,
          relationType: rel.relationType,
        };
      }
      continue;
    }
    seenApt.add(rel.apartmentId);
    scored.push({
      hit: {
        personId: rel.personId,
        apartmentId: rel.apartmentId,
        buildingId: rel.apartment.buildingId,
        fullName,
        relationType: rel.relationType,
      },
      quality,
    });
  }

  const fullHits = scored.filter((s) => s.quality === "FULL");
  if (fullHits.length === 1) {
    const { hit } = fullHits[0]!;
    return suggestion({
      apartmentId: hit.apartmentId,
      personId: hit.personId,
      buildingId: hit.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "HIGH",
      reason: reasonForFullName(hit.relationType),
      candidateCount: 1,
      matchKind: hit.relationType === "OWNER" ? "FULL_NAME_OWNER" : "FULL_NAME_TENANT",
      matchedPersonRole: hit.relationType,
      matchedPersonName: hit.fullName,
      nameMismatch: false,
    });
  }
  if (fullHits.length > 1) {
    return empty("Birden fazla kişi/daire adayı", fullHits.length);
  }

  const initialHits = scored.filter((s) => s.quality === "INITIALS");
  if (initialHits.length === 1) {
    const { hit } = initialHits[0]!;
    return suggestion({
      apartmentId: hit.apartmentId,
      personId: hit.personId,
      buildingId: hit.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "MEDIUM",
      reason: "Gönderen adı kısaltması ile kayıtlı kişi uyuştu.",
      candidateCount: 1,
      matchKind: "INITIALS_NAME",
      matchedPersonRole: hit.relationType,
      matchedPersonName: hit.fullName,
      nameMismatch: false,
    });
  }
  if (initialHits.length > 1) {
    return empty("Birden fazla kişi/daire adayı", initialHits.length);
  }

  const partialHits = scored.filter((s) => s.quality === "PARTIAL");
  if (partialHits.length === 1) {
    const { hit } = partialHits[0]!;
    return suggestion({
      apartmentId: hit.apartmentId,
      personId: hit.personId,
      buildingId: hit.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "MEDIUM",
      reason: "Gönderen adı kısmi eşleşti.",
      candidateCount: 1,
      matchKind: "PARTIAL_NAME",
      matchedPersonRole: hit.relationType,
      matchedPersonName: hit.fullName,
      nameMismatch: false,
    });
  }
  if (partialHits.length > 1) {
    return empty("Birden fazla kişi/daire adayı", partialHits.length);
  }

  // Surname only → never HIGH; unique surname → MEDIUM needing review; multiple → unmatched
  const surnameHits = scored.filter((s) => s.quality === "SURNAME");
  if (surnameHits.length === 1) {
    const { hit } = surnameHits[0]!;
    return suggestion({
      apartmentId: hit.apartmentId,
      personId: hit.personId,
      buildingId: hit.buildingId,
      matchStatus: "SUGGESTED",
      confidence: "MEDIUM",
      reason: "Yalnız soyadı benzerliği bulundu.",
      candidateCount: 1,
      matchKind: "SURNAME_ONLY",
      matchedPersonRole: hit.relationType,
      matchedPersonName: hit.fullName,
      nameMismatch: true,
    });
  }
  if (surnameHits.length > 1) {
    return empty("Yalnız soyadı eşleşiyor ve birden fazla aday var", surnameHits.length);
  }

  return empty(
    nameCandidates.length > 0
      ? "Bu gönderen aktif site sakinleri arasında bulunamadı."
      : "Eşleşme bulunamadı",
  );
}

export async function suggestStatementMatch(
  tenantId: string,
  siteId: string,
  bankAccountId: string,
  description: string,
): Promise<StatementMatchSuggestion> {
  const ctx = await loadStatementMatchContext(tenantId, siteId, bankAccountId);
  return suggestStatementMatchFromContext(ctx, description);
}
