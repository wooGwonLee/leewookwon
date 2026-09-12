import { Router } from "express";
import * as authController from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.post("/register", asyncHandler(authController.register));
router.post("/login", asyncHandler(authController.login));

export default router;
