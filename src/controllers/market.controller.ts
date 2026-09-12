import { Request, Response } from "express";
import * as marketService from "../services/market.service";
import { parsePagination } from "../utils/pagination";
import { SORTABLE_FIELDS, SortableField, SortOrder } from "../types/market.types";

// Returns null if the param is absent (no filter), undefined if present but invalid.
function parseNonNegativeNumberParam(value: unknown): number | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseSortBy(value: unknown): SortableField | undefined {
  if (value === undefined) {
    return "createdAt";
  }
  return SORTABLE_FIELDS.includes(value as SortableField) ? (value as SortableField) : undefined;
}

function parseSortOrder(value: unknown): SortOrder | undefined {
  if (value === undefined) {
    return "asc";
  }
  return value === "asc" || value === "desc" ? value : undefined;
}

export async function list(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  const minPrice = parseNonNegativeNumberParam(req.query.minPrice);
  const maxPrice = parseNonNegativeNumberParam(req.query.maxPrice);
  const q = typeof req.query.q === "string" && req.query.q.trim() !== "" ? req.query.q : undefined;
  const sortBy = parseSortBy(req.query.sortBy);
  const sortOrder = parseSortOrder(req.query.sortOrder);
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
  const inStock = req.query.inStock === "true" ? true : undefined;

  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  if (minPrice === undefined || maxPrice === undefined) {
    res.status(400).json({ error: "minPrice and maxPrice must be non-negative numbers" });
    return;
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    res.status(400).json({ error: "minPrice must not be greater than maxPrice" });
    return;
  }
  if (sortBy === undefined) {
    res.status(400).json({ error: `sortBy must be one of: ${SORTABLE_FIELDS.join(", ")}` });
    return;
  }
  if (sortOrder === undefined) {
    res.status(400).json({ error: "sortOrder must be one of: asc, desc" });
    return;
  }

  res.json(
    await marketService.listItems(
      pagination.page,
      pagination.limit,
      { q, minPrice: minPrice ?? undefined, maxPrice: maxPrice ?? undefined, categoryId, inStock },
      { sortBy, sortOrder },
    ),
  );
}

export async function get(req: Request, res: Response): Promise<void> {
  const item = await marketService.getItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, price, description, categoryId, stock } = req.body;
  if (typeof name !== "string" || typeof price !== "number") {
    res.status(400).json({ error: "name (string) and price (number) are required" });
    return;
  }
  if (categoryId !== undefined && typeof categoryId !== "string") {
    res.status(400).json({ error: "categoryId must be a string" });
    return;
  }
  if (stock !== undefined && !isNonNegativeInteger(stock)) {
    res.status(400).json({ error: "stock must be a non-negative integer" });
    return;
  }
  try {
    const item = await marketService.createItem({ name, price, description, categoryId, stock });
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof marketService.InvalidCategoryError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const { categoryId, stock } = req.body;
  if (categoryId !== undefined && categoryId !== null && typeof categoryId !== "string") {
    res.status(400).json({ error: "categoryId must be a string or null" });
    return;
  }
  if (stock !== undefined && !isNonNegativeInteger(stock)) {
    res.status(400).json({ error: "stock must be a non-negative integer" });
    return;
  }
  try {
    const item = await marketService.updateItem(req.params.id, req.body);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    if (err instanceof marketService.InvalidCategoryError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function adjustStock(req: Request, res: Response): Promise<void> {
  const { delta } = req.body;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
    res.status(400).json({ error: "delta must be a non-zero integer" });
    return;
  }
  try {
    const item = await marketService.adjustStock(req.params.id, delta);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(item);
  } catch (err) {
    if (err instanceof marketService.InsufficientStockError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await marketService.deleteItem(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (err instanceof marketService.ItemHasOrdersError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}
