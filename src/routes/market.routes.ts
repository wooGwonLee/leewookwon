import { Router } from "express";
import * as marketController from "../controllers/market.controller";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.get("/", asyncHandler(marketController.list));
router.get("/:id", asyncHandler(marketController.get));
router.post("/", asyncHandler(marketController.create));
router.patch("/:id", asyncHandler(marketController.update));
router.delete("/:id", asyncHandler(marketController.remove));

export default router;
