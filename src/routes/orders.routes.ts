import { Router } from "express";
import * as orderController from "../controllers/order.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, asyncHandler(orderController.create));
router.get("/", authenticate, asyncHandler(orderController.list));
router.get("/:id", authenticate, asyncHandler(orderController.get));
router.patch("/:id/cancel", authenticate, asyncHandler(orderController.cancel));
router.patch(
  "/:id/status",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(orderController.updateStatus),
);

export default router;
