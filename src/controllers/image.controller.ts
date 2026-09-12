import { Request, Response } from "express";
import * as imageService from "../services/image.service";

export async function upload(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "At least one image file is required (field name: images)" });
    return;
  }
  try {
    const images = await imageService.addImages(req.params.id, files);
    res.status(201).json({ images });
  } catch (err) {
    if (err instanceof imageService.MarketItemNotFoundError) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await imageService.removeImage(req.params.id, req.params.imageId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof imageService.ImageNotFoundError) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    throw err;
  }
}
