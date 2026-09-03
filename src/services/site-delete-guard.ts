import { prisma } from "../lib/prisma";

export type SiteRelationCount = {
  key: string;
  label: string;
  count: number;
};

function apartmentsOfSite(tenantId: string, siteId: string) {
  return {
    tenantId,
    deletedAt: null,
    building: { tenantId, siteId, deletedAt: null },
  } as const;
}

export async function countSiteRelations(
  tenantId: string,
  siteId: string,
): Promise<SiteRelationCount[]> {
  const apartmentWhere = apartmentsOfSite(tenantId, siteId);
  const viaBuilding = {
    tenantId,
    building: { tenantId, siteId, deletedAt: null },
  } as const;

  const [
    buildings,
    apartments,
    relations,
    dues,
    debts,
    payments,
    expenses,
    announcements,
    assets,
    bankAccounts,
    matchingRules,
    employees,
    visits,
    feedback,
    feedbackHistory,
    messages,
    batches,
    maintenances,
    movements,
  ] = await Promise.all([
    prisma.building.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.apartment.count({ where: apartmentWhere }),
    prisma.apartmentPersonRelation.count({
      where: { tenantId, apartment: apartmentWhere },
    }),
    prisma.duesDefinition.count({
      where: { ...viaBuilding, deletedAt: null },
    }),
    prisma.apartmentDebt.count({ where: viaBuilding }),
    prisma.payment.count({
      where: { tenantId, apartment: apartmentWhere },
    }),
    prisma.expense.count({
      where: { tenantId, siteId, cancelledAt: null },
    }),
    prisma.announcement.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.asset.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.bankAccount.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.bankMatchingRule.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.employeeAssignment.count({ where: { tenantId, siteId } }),
    prisma.visit.count({
      where: { tenantId, apartment: apartmentWhere },
    }),
    prisma.feedbackRecord.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.feedbackStatusHistory.count({ where: { tenantId, siteId } }),
    prisma.communicationMessage.count({ where: { tenantId, siteId } }),
    prisma.communicationBatch.count({ where: { tenantId, siteId } }),
    prisma.assetMaintenance.count({ where: { tenantId, siteId, deletedAt: null } }),
    prisma.assetMovement.count({ where: { tenantId, siteId } }),
  ]);

  const rows: SiteRelationCount[] = [
    { key: "buildings", label: "bina", count: buildings },
    { key: "apartments", label: "daire", count: apartments },
    { key: "relations", label: "sakin ilişkisi", count: relations },
    { key: "dues", label: "aidat tanımı", count: dues },
    { key: "debts", label: "borç", count: debts },
    { key: "payments", label: "tahsilat", count: payments },
    { key: "expenses", label: "gider", count: expenses },
    { key: "announcements", label: "duyuru", count: announcements },
    { key: "assets", label: "demirbaş", count: assets },
    { key: "bankAccounts", label: "banka hesabı", count: bankAccounts },
    { key: "matchingRules", label: "eşleştirme kuralı", count: matchingRules },
    { key: "employees", label: "personel ataması", count: employees },
    { key: "visits", label: "ziyaret", count: visits },
    { key: "feedback", label: "geri bildirim", count: feedback },
    { key: "feedbackHistory", label: "geri bildirim geçmişi", count: feedbackHistory },
    { key: "messages", label: "iletişim kaydı", count: messages },
    { key: "batches", label: "iletişim grubu", count: batches },
    { key: "maintenances", label: "bakım kaydı", count: maintenances },
    { key: "movements", label: "demirbaş hareketi", count: movements },
  ];

  return rows.filter((item) => item.count > 0);
}

export async function countSiteRelationsForPurge(tenantId: string, siteId: string) {
  const apartmentWhere = { tenantId, building: { tenantId, siteId } };
  const viaBuilding = { tenantId, building: { tenantId, siteId } };

  const [
    buildings,
    apartments,
    relations,
    debts,
    payments,
    expenses,
    announcements,
    assets,
    feedback,
    dues,
    visits,
    messages,
    batches,
    maintenances,
    movements,
    bankAccounts,
    matchingRules,
    employees,
    feedbackHistory,
  ] = await Promise.all([
    prisma.building.count({ where: { tenantId, siteId } }),
    prisma.apartment.count({ where: apartmentWhere }),
    prisma.apartmentPersonRelation.count({ where: { tenantId, apartment: apartmentWhere } }),
    prisma.apartmentDebt.count({ where: viaBuilding }),
    prisma.payment.count({ where: { tenantId, apartment: apartmentWhere } }),
    prisma.expense.count({ where: { tenantId, siteId } }),
    prisma.announcement.count({ where: { tenantId, siteId } }),
    prisma.asset.count({ where: { tenantId, siteId } }),
    prisma.feedbackRecord.count({ where: { tenantId, siteId } }),
    prisma.duesDefinition.count({ where: viaBuilding }),
    prisma.visit.count({ where: { tenantId, apartment: apartmentWhere } }),
    prisma.communicationMessage.count({ where: { tenantId, siteId } }),
    prisma.communicationBatch.count({ where: { tenantId, siteId } }),
    prisma.assetMaintenance.count({ where: { tenantId, siteId } }),
    prisma.assetMovement.count({ where: { tenantId, siteId } }),
    prisma.bankAccount.count({ where: { tenantId, siteId } }),
    prisma.bankMatchingRule.count({ where: { tenantId, siteId } }),
    prisma.employeeAssignment.count({ where: { tenantId, siteId } }),
    prisma.feedbackStatusHistory.count({ where: { tenantId, siteId } }),
  ]);

  const other =
    dues +
    visits +
    messages +
    batches +
    maintenances +
    movements +
    bankAccounts +
    matchingRules +
    employees +
    feedbackHistory;

  return {
    buildings,
    apartments,
    assets,
    announcements,
    relations,
    debts,
    payments,
    expenses,
    feedback,
    other,
  };
}

export function formatSiteDeleteBlockedMessage(counts: SiteRelationCount[]): string {
  const lines = counts.map((item) => `${item.count} ${item.label}`);
  return [
    "Bu site silinemiyor. Siteye bağlı bina, daire veya başka kayıtlar bulunmaktadır. Önce ilgili kayıtları kaldırın ya da siteyi arşivleyin.",
    "",
    ...lines,
  ].join("\n");
}
