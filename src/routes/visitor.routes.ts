import { Router } from "express";
import {
  createVisitor,
  deleteVisitor,
  getVisitor,
  listVisitors,
  updateVisitor,
} from "../controllers/visitor.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const visitorRouter = Router();

visitorRouter.use(requireAuth, requireTenant);

visitorRouter.get("/", listVisitors);
visitorRouter.get("/:id", getVisitor);
visitorRouter.post("/", createVisitor);
visitorRouter.patch("/:id", updateVisitor);
visitorRouter.delete("/:id", deleteVisitor);
