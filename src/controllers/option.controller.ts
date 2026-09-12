import { Request, Response } from "express";
import * as optionService from "../services/option.service";
import { CreateOptionInput, UpdateOptionInput } from "../types/option.types";

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseCreateInput(body: unknown): CreateOptionInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { name, priceDelta, stock } = body as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") {
    return undefined;
  }
  if (priceDelta !== undefined && typeof priceDelta !== "number") {
    return undefined;
  }
  if (stock !== undefined && !isNonNegativeInteger(stock)) {
    return undefined;
  }
  return { name, priceDelta: priceDelta as number | undefined, stock: stock as number | undefined };
}

function parseUpdateInput(body: unknown): UpdateOptionInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { name, priceDelta, stock } = body as Record<string, unknown>;
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    return undefined;
  }
  if (priceDelta !== undefined && typeof priceDelta !== "number") {
    return undefined;
  }
  if (stock !== undefined && !isNonNegativeInteger(stock)) {
    return undefined;
  }
  return {
    name: name as string | undefined,
    priceDelta: priceDelta as number | undefined,
    stock: stock as number | undefined,
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = parseCreateInput(req.body);
  if (!parsed) {
    res.status(400).json({
      error: "name (non-empty string) is required; priceDelta must be a number, stock a non-negative integer",
    });
    return;
  }
  try {
    const option = await optionService.createOption(req.params.id, parsed);
    res.status(201).json(option);
  } catch (err) {
    if (err instanceof optionService.MarketItemNotFoundError) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    if (err instanceof optionService.OptionNameConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const parsed = parseUpdateInput(req.body);
  if (!parsed) {
    res.status(400).json({
      error:
        "name must be a non-empty string; priceDelta must be a number, stock a non-negative integer",
    });
    return;
  }
  try {
    const option = await optionService.updateOption(req.params.id, req.params.optionId, parsed);
    res.json(option);
  } catch (err) {
    if (err instanceof optionService.OptionNotFoundError) {
      res.status(404).json({ error: "Option not found" });
      return;
    }
    if (err instanceof optionService.OptionNameConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await optionService.deleteOption(req.params.id, req.params.optionId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof optionService.OptionNotFoundError) {
      res.status(404).json({ error: "Option not found" });
      return;
    }
    if (err instanceof optionService.OptionHasOrdersError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}
