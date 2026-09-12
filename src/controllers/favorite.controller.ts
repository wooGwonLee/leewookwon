import { Request, Response } from "express";
import * as favoriteService from "../services/favorite.service";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveIntParam(
  value: unknown,
  { defaultValue, max }: { defaultValue: number; max?: number },
): number | undefined {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return max ? Math.min(parsed, max) : parsed;
}

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
  const page = parsePositiveIntParam(req.query.page, { defaultValue: 1 });
  const limit = parsePositiveIntParam(req.query.limit, {
    defaultValue: DEFAULT_LIMIT,
    max: MAX_LIMIT,
  });
  if (page === undefined || limit === undefined) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  res.json(await favoriteService.listUserFavorites(req.user!.sub, page, limit));
}
