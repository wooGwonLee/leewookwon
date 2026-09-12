import { Request, Response } from "express";
import * as statsService from "../services/stats.service";
import * as marketService from "../services/market.service";
import { parsePagination, MAX_LIMIT } from "../utils/pagination";

function parseNonNegativeInt(value: unknown, defaultValue: number): number | undefined {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

export async function summary(req: Request, res: Response): Promise<void> {
  const threshold = parseNonNegativeInt(
    req.query.lowStockThreshold,
    statsService.DEFAULT_LOW_STOCK_THRESHOLD,
  );
  if (threshold === undefined) {
    res.status(400).json({ error: "lowStockThreshold must be a non-negative integer" });
    return;
  }
  res.json(await statsService.getSummary(threshold));
}

export async function topItems(req: Request, res: Response): Promise<void> {
  const limit = parseNonNegativeInt(req.query.limit, 10);
  if (limit === undefined || limit < 1) {
    res.status(400).json({ error: "limit must be a positive integer" });
    return;
  }
  res.json(await statsService.getTopSellingItems(Math.min(limit, MAX_LIMIT)));
}

export async function lowStock(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  const threshold = parseNonNegativeInt(
    req.query.threshold,
    statsService.DEFAULT_LOW_STOCK_THRESHOLD,
  );
  if (threshold === undefined) {
    res.status(400).json({ error: "threshold must be a non-negative integer" });
    return;
  }
  res.json(
    await marketService.listItems(
      pagination.page,
      pagination.limit,
      { maxStock: threshold },
      { sortBy: "stock", sortOrder: "asc" },
    ),
  );
}
