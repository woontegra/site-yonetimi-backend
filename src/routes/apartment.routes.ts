import { Router } from "express";
import {
  createApartment,
  deleteApartment,
  getApartment,
  listApartments,
  updateApartment,
} from "../controllers/apartment.controller";
import { requireAuth } from "../middleware/auth";
import { requireSite } from "../middleware/site";
import { requireTenant } from "../middleware/tenant";

export const apartmentRouter = Router();

apartmentRouter.use(requireAuth, requireTenant, requireSite);

apartmentRouter.get("/", listApartments);
apartmentRouter.get("/:id", getApartment);
apartmentRouter.post("/", createApartment);
apartmentRouter.patch("/:id", updateApartment);
apartmentRouter.delete("/:id", deleteApartment);
