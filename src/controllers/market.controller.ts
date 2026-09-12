import { Request, Response } from "express";
import * as marketService from "../services/market.service";

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

export async function list(req: Request, res: Response): Promise<void> {
  const page = parsePositiveIntParam(req.query.page, { defaultValue: 1 });
  const limit = parsePositiveIntParam(req.query.limit, {
    defaultValue: DEFAULT_LIMIT,
    max: MAX_LIMIT,
  });
  if (page === undefined || limit === undefined) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  res.json(await marketService.listItems(page, limit));
}

export async function get(req: Request, res: Response): Promise<void> {
  const item = await marketService.getItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, price, description } = req.body;
  if (typeof name !== "string" || typeof price !== "number") {
    res.status(400).json({ error: "name (string) and price (number) are required" });
    return;
  }
  const item = await marketService.createItem({ name, price, description });
  res.status(201).json(item);
}

export async function update(req: Request, res: Response): Promise<void> {
  const item = await marketService.updateItem(req.params.id, req.body);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const deleted = await marketService.deleteItem(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.status(204).send();
}
