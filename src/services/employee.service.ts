import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { assertBuildingInSite, assertSiteInTenant } from "../utils/siteScope";
import { HttpError } from "../utils/httpError";
import type {
  CreateAssignmentInput,
  CreateEmployeeInput,
  EndAssignmentInput,
  ListEmployeesQuery,
  TerminateEmployeeInput,
  UpdateEmployeeInput,
} from "../validators/employee.validators";

function fullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

function formatAssignmentPlace(row: {
  site?: { id: string; name: string } | null;
  building: { id: string; name: string } | null;
}) {
  const siteName = row.site?.name ?? "Site";
  const place = row.building ? row.building.name : "Site Geneli";
  return `${siteName} · ${place}`;
}

function mapAssignment(row: {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  site?: { id: string; name: string } | null;
  building: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    scopeLabel: formatAssignmentPlace(row),
    site: row.site ?? null,
    building: row.building,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEmployee(
  row: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    jobTitle: string;
    hireDate: Date | null;
    terminationDate: Date | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    assignments?: Array<{
      id: string;
      startDate: Date | null;
      endDate: Date | null;
      isActive: boolean;
      note: string | null;
      createdAt: Date;
      updatedAt: Date;
      site?: { id: string; name: string } | null;
      building: { id: string; name: string } | null;
    }>;
  },
  options?: { includeAssignments?: boolean },
) {
  const activeAssignments = (row.assignments ?? []).filter((item) => item.isActive);
  let assignmentSummary = "—";
  if (activeAssignments.length === 1) {
    assignmentSummary = formatAssignmentPlace(activeAssignments[0]);
  } else if (activeAssignments.length > 1) {
    assignmentSummary = `${activeAssignments.length} görev yeri`;
  }

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: fullName(row.firstName, row.lastName),
    phone: row.phone,
    email: row.email,
    address: row.address,
    jobTitle: row.jobTitle,
    hireDate: row.hireDate,
    terminationDate: row.terminationDate,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    assignmentSummary,
    ...(options?.includeAssignments
      ? {
          assignments: (row.assignments ?? []).map(mapAssignment),
        }
      : {}),
  };
}

const assignmentInclude = {
  site: { select: { id: true, name: true } },
  building: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeAssignmentInclude;

export class EmployeeService {
  async list(tenantId: string, query: ListEmployeesQuery, siteId?: string | null) {
    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (query.status === "aktif") where.isActive = true;
    if (query.status === "pasif") where.isActive = false;
    if (query.jobTitle) {
      where.jobTitle = { contains: query.jobTitle, mode: "insensitive" };
    }
    if (siteId) {
      where.assignments = {
        some: { siteId, isActive: true },
      };
    }

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { jobTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    const skip = (query.page - 1) * query.perPage;
    const assignmentWhere = siteId ? { isActive: true, siteId } : { isActive: true };
    const [rows, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        include: {
          assignments: {
            where: assignmentWhere,
            include: assignmentInclude,
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.perPage,
      }),
      prisma.employee.count({ where }),
    ]);

    return {
      items: rows.map((row) => mapEmployee(row)),
      page: query.page,
      perPage: query.perPage,
      total,
    };
  }

  async getById(tenantId: string, id: string, siteId?: string | null) {
    const row = await prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        assignments: {
          where: siteId ? { siteId } : undefined,
          include: assignmentInclude,
          orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!row) throw new HttpError(404, "Çalışan bulunamadı.");
    return mapEmployee(row, { includeAssignments: true });
  }

  async create(tenantId: string, input: CreateEmployeeInput) {
    const { assignment } = input;
    await assertSiteInTenant(tenantId, assignment.siteId, { requireActive: true });
    const buildingId = assignment.scope === "BUILDING" ? assignment.buildingId : null;
    if (buildingId) {
      await assertBuildingInSite(tenantId, assignment.siteId, buildingId);
    }

    const row = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          tenantId,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone,
          email: input.email?.toLowerCase(),
          address: input.address,
          jobTitle: input.jobTitle.trim(),
          hireDate: input.hireDate,
          isActive: true,
        },
      });

      await tx.employeeAssignment.create({
        data: {
          tenantId,
          siteId: assignment.siteId,
          employeeId: employee.id,
          buildingId: buildingId ?? null,
          startDate: assignment.startDate ?? input.hireDate ?? new Date(),
          note: assignment.note,
          isActive: true,
        },
      });

      return tx.employee.findFirstOrThrow({
        where: { id: employee.id },
        include: {
          assignments: {
            include: assignmentInclude,
            orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
          },
        },
      });
    });

    return mapEmployee(row, { includeAssignments: true });
  }

  async update(tenantId: string, id: string, input: UpdateEmployeeInput) {
    const current = await prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Çalışan bulunamadı.");

    const row = await prisma.employee.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined
          ? { email: input.email ? input.email.toLowerCase() : null }
          : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle.trim() } : {}),
        ...(input.hireDate !== undefined ? { hireDate: input.hireDate } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: {
        assignments: {
          include: assignmentInclude,
          orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        },
      },
    });

    return mapEmployee(row, { includeAssignments: true });
  }

  async terminate(tenantId: string, id: string, input: TerminateEmployeeInput) {
    const current = await prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!current) throw new HttpError(404, "Çalışan bulunamadı.");
    if (!current.isActive) {
      throw new HttpError(400, "Çalışan zaten pasif.");
    }

    const row = await prisma.$transaction(async (tx) => {
      await tx.employeeAssignment.updateMany({
        where: { tenantId, employeeId: id, isActive: true },
        data: {
          isActive: false,
          endDate: input.terminationDate,
        },
      });

      return tx.employee.update({
        where: { id },
        data: {
          isActive: false,
          terminationDate: input.terminationDate,
        },
        include: {
          assignments: {
            include: assignmentInclude,
            orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
          },
        },
      });
    });

    return mapEmployee(row, { includeAssignments: true });
  }

  async softDelete(tenantId: string, id: string) {
    const current = await prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Çalışan bulunamadı.");

    await prisma.$transaction(async (tx) => {
      await tx.employeeAssignment.updateMany({
        where: { tenantId, employeeId: id, isActive: true },
        data: {
          isActive: false,
          endDate: new Date(),
        },
      });
      await tx.employee.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });
    });

    return { ok: true };
  }

  async createAssignment(tenantId: string, siteId: string, input: CreateAssignmentInput) {
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, tenantId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!employee) throw new HttpError(404, "Çalışan bulunamadı.");
    if (!employee.isActive) {
      throw new HttpError(400, "Pasif çalışana görevlendirme yapılamaz.");
    }

    const buildingId = input.scope === "BUILDING" ? input.buildingId : null;
    if (buildingId) {
      await assertBuildingInSite(tenantId, siteId, buildingId);
    }

    const row = await prisma.employeeAssignment.create({
      data: {
        tenantId,
        siteId,
        employeeId: input.employeeId,
        buildingId,
        startDate: input.startDate,
        note: input.note,
        isActive: true,
      },
      include: assignmentInclude,
    });

    return mapAssignment(row);
  }

  async endAssignment(
    tenantId: string,
    assignmentId: string,
    input: EndAssignmentInput,
    siteId?: string | null,
  ) {
    const current = await prisma.employeeAssignment.findFirst({
      where: {
        id: assignmentId,
        tenantId,
        ...(siteId ? { siteId } : {}),
      },
      select: { id: true, isActive: true },
    });
    if (!current) throw new HttpError(404, "Görevlendirme bulunamadı.");
    if (!current.isActive) {
      throw new HttpError(400, "Görevlendirme zaten sonlandırılmış.");
    }

    const row = await prisma.employeeAssignment.update({
      where: { id: assignmentId },
      data: {
        isActive: false,
        endDate: input.endDate,
      },
      include: assignmentInclude,
    });

    return mapAssignment(row);
  }
}

export const employeeService = new EmployeeService();
