import { Router } from "express";
import * as statsController from "../controllers/stats.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();

router.get(
  "/stats/summary",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(statsController.summary),
);
router.get(
  "/stats/top-items",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(statsController.topItems),
);
router.get(
  "/stats/low-stock",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(statsController.lowStock),
);

export default router;
