import { randomUUID } from "crypto";
import {
  CreateMarketItemInput,
  MarketItem,
  UpdateMarketItemInput,
} from "../types/market.types";

const items = new Map<string, MarketItem>();

export function listItems(): MarketItem[] {
  return Array.from(items.values());
}

export function getItem(id: string): MarketItem | undefined {
  return items.get(id);
}

export function createItem(input: CreateMarketItemInput): MarketItem {
  const now = new Date().toISOString();
  const item: MarketItem = {
    id: randomUUID(),
    name: input.name,
    price: input.price,
    description: input.description,
    createdAt: now,
    updatedAt: now,
  };
  items.set(item.id, item);
  return item;
}

export function updateItem(
  id: string,
  input: UpdateMarketItemInput,
): MarketItem | undefined {
  const existing = items.get(id);
  if (!existing) {
    return undefined;
  }
  const updated: MarketItem = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  items.set(id, updated);
  return updated;
}

export function deleteItem(id: string): boolean {
  return items.delete(id);
}
