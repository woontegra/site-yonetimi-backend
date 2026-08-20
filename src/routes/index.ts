import { Router } from "express";
import { authRouter } from "./auth.routes";
import { buildingRouter } from "./building.routes";
import { healthRouter } from "./health.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/buildings", buildingRouter);
