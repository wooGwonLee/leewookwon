import { Request, Response } from "express";
import * as favoriteService from "../services/favorite.service";
import { parsePagination } from "../utils/pagination";

export async function add(req: Request, res: Response): Promise<void> {
  try {
    const { created } = await favoriteService.addFavorite(req.user!.sub, req.params.id);
    res.status(created ? 201 : 200).json({ favorited: true });
  } catch (err) {
    if (err instanceof favoriteService.MarketItemNotFoundError) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const removed = await favoriteService.removeFavorite(req.user!.sub, req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Favorite not found" });
    return;
  }
  res.status(204).send();
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  const [favorited, favoriteCount] = await Promise.all([
    favoriteService.isFavorited(req.user!.sub, req.params.id),
    favoriteService.countFavorites(req.params.id),
  ]);
  res.json({ favorited, favoriteCount });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  res.json(
    await favoriteService.listUserFavorites(req.user!.sub, pagination.page, pagination.limit),
  );
}
