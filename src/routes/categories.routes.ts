import { Router } from "express";
import * as categoryController from "../controllers/category.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();

router.get("/", asyncHandler(categoryController.list));
router.post("/", authenticate, authorize("ADMIN"), asyncHandler(categoryController.create));
router.patch("/:id", authenticate, authorize("ADMIN"), asyncHandler(categoryController.update));
router.delete("/:id", authenticate, authorize("ADMIN"), asyncHandler(categoryController.remove));

export default router;
