import { Request, Response } from "express";
import * as marketService from "../services/market.service";

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await marketService.listItems());
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
