import { Request, Response } from "express";
import * as categoryService from "../services/category.service";
import { parsePagination } from "../utils/pagination";

function parseName(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { name } = body as Record<string, unknown>;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

export async function list(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  res.json(await categoryService.listCategories(pagination.page, pagination.limit));
}

export async function create(req: Request, res: Response): Promise<void> {
  const name = parseName(req.body);
  if (!name) {
    res.status(400).json({ error: "name (non-empty string) is required" });
    return;
  }
  try {
    const category = await categoryService.createCategory({ name });
    res.status(201).json(category);
  } catch (err) {
    if (err instanceof categoryService.CategoryNameTakenError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const name = parseName(req.body);
  if (!name) {
    res.status(400).json({ error: "name (non-empty string) is required" });
    return;
  }
  try {
    const category = await categoryService.updateCategory(req.params.id, { name });
    res.json(category);
  } catch (err) {
    if (err instanceof categoryService.CategoryNotFoundError) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    if (err instanceof categoryService.CategoryNameTakenError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  const deleted = await categoryService.deleteCategory(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.status(204).send();
}
