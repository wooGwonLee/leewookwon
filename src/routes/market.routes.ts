import { Router } from "express";
import * as marketController from "../controllers/market.controller";

const router = Router();

router.get("/", marketController.list);
router.get("/:id", marketController.get);
router.post("/", marketController.create);
router.patch("/:id", marketController.update);
router.delete("/:id", marketController.remove);

export default router;
