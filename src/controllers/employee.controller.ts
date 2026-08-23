import type { NextFunction, Request, Response } from "express";
import { assertSiteActive } from "../middleware/site";
import { employeeService } from "../services/employee.service";
import { HttpError } from "../utils/httpError";
import {
  createAssignmentSchema,
  createEmployeeSchema,
  endAssignmentSchema,
  listEmployeesQuerySchema,
  terminateEmployeeSchema,
  updateEmployeeSchema,
} from "../validators/employee.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function optionalSiteIdFrom(req: Request): string | null {
  return req.auth?.siteId ?? null;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listEmployeesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await employeeService.list(tenantIdFrom(req), parsed.data, optionalSiteIdFrom(req)));
  } catch (error) {
    next(error);
  }
}

export async function getEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await employeeService.getById(
      tenantIdFrom(req),
      String(req.params.id),
      optionalSiteIdFrom(req),
    );
    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
}

export async function createEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const employee = await employeeService.create(tenantIdFrom(req), parsed.data);
    res.status(201).json({ employee });
  } catch (error) {
    next(error);
  }
}

export async function updateEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const employee = await employeeService.update(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
}

export async function terminateEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = terminateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const employee = await employeeService.terminate(
      tenantIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ employee });
  } catch (error) {
    next(error);
  }
}

export async function deleteEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    await employeeService.softDelete(tenantIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function createEmployeeAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const siteId = optionalSiteIdFrom(req);
    if (!siteId) {
      throw new HttpError(400, "Aktif site seçilmedi.");
    }
    const parsed = createAssignmentSchema.safeParse({
      ...req.body,
      employeeId: req.body.employeeId ?? req.params.id,
    });
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const assignment = await employeeService.createAssignment(
      tenantIdFrom(req),
      siteId,
      parsed.data,
    );
    res.status(201).json({ assignment });
  } catch (error) {
    next(error);
  }
}

export async function endEmployeeAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = endAssignmentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const assignment = await employeeService.endAssignment(
      tenantIdFrom(req),
      String(req.params.assignmentId),
      parsed.data,
      optionalSiteIdFrom(req),
    );
    res.status(200).json({ assignment });
  } catch (error) {
    next(error);
  }
}
