import { Router } from "express";
import * as marketController from "../controllers/market.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();

router.get("/", asyncHandler(marketController.list));
router.get("/:id", asyncHandler(marketController.get));
router.post("/", authenticate, asyncHandler(marketController.create));
router.patch("/:id", authenticate, asyncHandler(marketController.update));
router.delete("/:id", authenticate, authorize("ADMIN"), asyncHandler(marketController.remove));

export default router;
