import { Router } from "express";
import {
  createRelation,
  deleteRelation,
  listRelations,
  updateRelation,
} from "../controllers/relation.controller";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";

export const relationRouter = Router();

relationRouter.use(requireAuth, requireTenant);

relationRouter.get("/", listRelations);
relationRouter.post("/", createRelation);
relationRouter.patch("/:id", updateRelation);
relationRouter.delete("/:id", deleteRelation);
