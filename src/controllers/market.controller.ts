import { Request, Response } from "express";
import * as marketService from "../services/market.service";

export function list(_req: Request, res: Response): void {
  res.json(marketService.listItems());
}

export function get(req: Request, res: Response): void {
  const item = marketService.getItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
}

export function create(req: Request, res: Response): void {
  const { name, price, description } = req.body;
  if (typeof name !== "string" || typeof price !== "number") {
    res.status(400).json({ error: "name (string) and price (number) are required" });
    return;
  }
  const item = marketService.createItem({ name, price, description });
  res.status(201).json(item);
}

export function update(req: Request, res: Response): void {
  const item = marketService.updateItem(req.params.id, req.body);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json(item);
}

export function remove(req: Request, res: Response): void {
  const deleted = marketService.deleteItem(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.status(204).send();
}
