import { Router } from "express";
import * as marketController from "../controllers/market.controller";
import * as favoriteController from "../controllers/favorite.controller";
import * as reviewController from "../controllers/review.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, authorize } from "../middleware/auth.middleware";

const router = Router();

router.get("/", asyncHandler(marketController.list));
router.get("/:id", asyncHandler(marketController.get));
router.post("/", authenticate, asyncHandler(marketController.create));
router.patch("/:id", authenticate, asyncHandler(marketController.update));
router.delete("/:id", authenticate, authorize("ADMIN"), asyncHandler(marketController.remove));

router.get("/:id/favorite", authenticate, asyncHandler(favoriteController.getStatus));
router.post("/:id/favorite", authenticate, asyncHandler(favoriteController.add));
router.delete("/:id/favorite", authenticate, asyncHandler(favoriteController.remove));

router.get("/:id/reviews", asyncHandler(reviewController.list));
router.post("/:id/reviews", authenticate, asyncHandler(reviewController.create));
router.patch("/:id/reviews/:reviewId", authenticate, asyncHandler(reviewController.update));
router.delete("/:id/reviews/:reviewId", authenticate, asyncHandler(reviewController.remove));

export default router;
