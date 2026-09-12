import { NextFunction, Request, Response } from "express";
import { uploadMarketItemImages } from "../upload";

export function handleImageUpload(req: Request, res: Response, next: NextFunction): void {
  uploadMarketItemImages(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Invalid upload";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}
