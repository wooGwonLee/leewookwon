import { Router } from "express";
import * as userController from "../controllers/user.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authenticate, authorize("ADMIN"), asyncHandler(userController.list));
router.patch(
  "/:id/role",
  authenticate,
  authorize("ADMIN"),
  asyncHandler(userController.updateRole),
);

export default router;
