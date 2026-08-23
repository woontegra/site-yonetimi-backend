import { prisma } from "../lib/prisma";
import { toMoneyString, todayUtc } from "../utils/money";
import { announcementService } from "./announcement.service";
import { apartmentDebtService } from "./debt.service";
import { assetService } from "./asset.service";
import { expenseService } from "./expense.service";
import { paymentService } from "./payment.service";
import { siteSetupService } from "./site-setup.service";
import { visitService } from "./visit.service";

function moneySum(...values: Array<string | number>): string {
  let sum = 0;
  for (const value of values) {
    sum += Number(value);
  }
  return toMoneyString(sum);
}

export class DashboardService {
  async getOverview(tenantId: string, siteId: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const today = todayUtc();
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const [
      setup,
      activeApartments,
      paymentMonth,
      expenseMonth,
      openDebts,
      periodOpen,
      periodPaid,
      dueMonthOpen,
      dueMonthPaid,
      recentPayments,
      recentExpenses,
      insideVisits,
      announcements,
      upcomingAssets,
      upcomingDebts,
    ] = await Promise.all([
      siteSetupService.getSummary(tenantId, siteId),
      prisma.apartment.count({
        where: {
          tenantId,
          deletedAt: null,
          isActive: true,
          building: { siteId, deletedAt: null },
        },
      }),
      paymentService.monthlySummary(tenantId, siteId, year),
      expenseService.monthlySummary(tenantId, siteId, year),
      apartmentDebtService.list(tenantId, siteId, { page: 1, perPage: 1, status: "OPEN" }),
      apartmentDebtService.list(tenantId, siteId, {
        page: 1,
        perPage: 1,
        status: "OPEN",
        periodYear: year,
        periodMonth: month,
      }),
      apartmentDebtService.list(tenantId, siteId, {
        page: 1,
        perPage: 1,
        status: "PAID",
        periodYear: year,
        periodMonth: month,
      }),
      apartmentDebtService.list(tenantId, siteId, {
        page: 1,
        perPage: 1,
        status: "OPEN",
        dueFrom: monthStart,
        dueTo: monthEnd,
      }),
      apartmentDebtService.list(tenantId, siteId, {
        page: 1,
        perPage: 1,
        status: "PAID",
        dueFrom: monthStart,
        dueTo: monthEnd,
      }),
      paymentService.list(tenantId, siteId, { page: 1, perPage: 5, status: "COMPLETED" }),
      expenseService.list(tenantId, siteId, { page: 1, perPage: 5, status: "COMPLETED" }),
      visitService.list(tenantId, siteId, { page: 1, perPage: 5, status: "INSIDE" }),
      announcementService.list(tenantId, siteId, { page: 1, perPage: 4, status: "PUBLISHED" }),
      assetService.list(tenantId, siteId, { page: 1, perPage: 5, upcomingMaintenanceDays: 45 }),
      prisma.apartmentDebt.findMany({
        where: {
          tenantId,
          status: "OPEN",
          remainingAmount: { gt: 0 },
          dueDate: { gte: today },
          building: { siteId, deletedAt: null },
          apartment: { deletedAt: null, building: { siteId, deletedAt: null } },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          remainingAmount: true,
          apartment: { select: { number: true } },
          building: { select: { name: true } },
        },
        orderBy: { dueDate: "asc" },
        take: 5,
      }),
    ]);

    const periodAccrual = moneySum(
      periodOpen.summary.totalOriginalAmount,
      periodPaid.summary.totalOriginalAmount,
    );
    const dueAccrual = moneySum(
      dueMonthOpen.summary.totalOriginalAmount,
      dueMonthPaid.summary.totalOriginalAmount,
    );
    const accrued = Number(periodAccrual) > 0 ? periodAccrual : dueAccrual;
    const collected = paymentMonth.currentMonthTotal;
    const expenseTotal = expenseMonth.currentMonthTotal;
    const accruedNum = Number(accrued);
    const collectedNum = Number(collected);
    const collectionRatePercent =
      accruedNum > 0 ? Math.min(100, Math.round((collectedNum / accruedNum) * 100)) : null;

    const recentActivity = [
      ...recentPayments.items.map((item) => ({
        id: item.id,
        type: "payment" as const,
        title: item.title,
        subtitle: `${item.building.name} · Daire ${item.apartment.number}`,
        amount: item.amount,
        occurredAt: item.paymentDate,
        href: `/app/muhasebe/tahsilatlar/${item.id}`,
      })),
      ...recentExpenses.items.map((item) => ({
        id: item.id,
        type: "expense" as const,
        title: item.title,
        subtitle: item.expenseType.name,
        amount: item.amount,
        occurredAt: item.expenseDate,
        href: `/app/muhasebe/giderler/${item.id}`,
      })),
    ]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, 8);

    const owners = setup.counts.owners;
    const tenants = setup.counts.tenants;

    return {
      site: {
        id: setup.site.id,
        name: setup.site.name,
      },
      setupStatus: {
        status: setup.site.setupStatus,
        completed: setup.site.setupStatus === "COMPLETED" || setup.site.setupStatus === "SKIPPED",
      },
      apartmentSummary: {
        total: setup.counts.apartments,
        active: activeApartments,
      },
      residentSummary: {
        total: owners + tenants,
        owners,
        tenants,
      },
      financeSummary: {
        year,
        month,
        accrued,
        collected,
        expense: expenseTotal,
        openDebt: openDebts.summary.totalRemainingAmount,
        openDebtCount: openDebts.summary.openDebtCount,
        indebtedApartmentCount: openDebts.summary.indebtedApartmentCount,
        collectionRatePercent,
      },
      recentActivity,
      upcoming: [
        ...upcomingDebts.map((item) => ({
          id: item.id,
          type: "debt" as const,
          title: item.title,
          subtitle: `${item.building.name} · Daire ${item.apartment.number}`,
          date: item.dueDate.toISOString(),
          amount: toMoneyString(item.remainingAmount),
          href: `/app/muhasebe/borclar/${item.id}`,
        })),
        ...upcomingAssets.items.map((item) => ({
          id: item.id,
          type: "maintenance" as const,
          title: item.name,
          subtitle: item.building?.name ?? item.location ?? "Demirbaş",
          date: item.nextMaintenanceDate,
          amount: null as string | null,
          href: `/app/demirbaslar/${item.id}`,
        })),
      ]
        .filter((item) => item.date)
        .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime())
        .slice(0, 6),
      activeVisitors: {
        count: insideVisits.summary.insideCount,
        items: insideVisits.items.map((item) => ({
          id: item.id,
          visitorName: item.visitor.fullName,
          apartmentLabel: `${item.building.name} · Daire ${item.apartment.number}`,
          checkInAt: item.checkInAt,
          href: `/app/misafirler/ziyaretler/${item.id}`,
        })),
      },
      activeAnnouncements: announcements.items.map((item) => ({
        id: item.id,
        title: item.title,
        publishedAt: item.publishedAt ?? item.createdAt,
        audienceLabel: item.audienceLabel,
        targetSummary: item.targetSummary,
        href: `/app/duyurular/${item.id}`,
      })),
      upcomingMaintenances: {
        count: upcomingAssets.total,
        items: [...upcomingAssets.items]
          .sort((a, b) => {
            const left = a.nextMaintenanceDate ? new Date(a.nextMaintenanceDate).getTime() : 0;
            const right = b.nextMaintenanceDate ? new Date(b.nextMaintenanceDate).getTime() : 0;
            return left - right;
          })
          .map((item) => ({
            id: item.id,
            name: item.name,
            nextMaintenanceDate: item.nextMaintenanceDate,
            href: `/app/demirbaslar/${item.id}`,
          })),
      },
    };
  }
}

export const dashboardService = new DashboardService();
