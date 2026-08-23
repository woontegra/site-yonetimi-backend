import { Router } from "express";
import {
  createEmployee,
  createEmployeeAssignment,
  deleteEmployee,
  endEmployeeAssignment,
  getEmployee,
  listEmployees,
  terminateEmployee,
  updateEmployee,
} from "../controllers/employee.controller";
import { requireAuth } from "../middleware/auth";
import { optionalSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const employeeRouter = Router();

employeeRouter.use(requireAuth, requireTenant, optionalSite);

employeeRouter.get("/", listEmployees);
employeeRouter.get("/:id", getEmployee);
employeeRouter.post("/", createEmployee);
employeeRouter.patch("/:id", updateEmployee);
employeeRouter.post("/:id/terminate", terminateEmployee);
employeeRouter.delete("/:id", deleteEmployee);
employeeRouter.post("/:id/assignments", createEmployeeAssignment);
employeeRouter.post("/assignments/:assignmentId/end", endEmployeeAssignment);
