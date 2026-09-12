import { Router } from "express";
import * as addressController from "../controllers/address.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, asyncHandler(addressController.create));
router.get("/", authenticate, asyncHandler(addressController.list));
router.get("/:id", authenticate, asyncHandler(addressController.get));
router.patch("/:id", authenticate, asyncHandler(addressController.update));
router.delete("/:id", authenticate, asyncHandler(addressController.remove));

export default router;
