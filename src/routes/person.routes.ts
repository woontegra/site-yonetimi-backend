import { Router } from "express";
import {
  createPerson,
  createPersonWithRelation,
  deletePerson,
  getPerson,
  listPersons,
  updatePerson,
} from "../controllers/person.controller";
import { requireAuth } from "../middleware/auth";
import { optionalSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const personRouter = Router();

personRouter.use(requireAuth, requireTenant, optionalSite);

personRouter.get("/", listPersons);
personRouter.post("/with-relation", createPersonWithRelation);
personRouter.get("/:id", getPerson);
personRouter.post("/", createPerson);
personRouter.patch("/:id", updatePerson);
personRouter.delete("/:id", deletePerson);
