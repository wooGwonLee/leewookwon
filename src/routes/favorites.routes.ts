import { Router } from "express";
import * as favoriteController from "../controllers/favorite.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authenticate, asyncHandler(favoriteController.listMine));

export default router;
