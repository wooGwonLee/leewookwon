import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  CreateMarketItemInput,
  MarketItem,
  UpdateMarketItemInput,
} from "../types/market.types";

export function listItems(): Promise<MarketItem[]> {
  return prisma.marketItem.findMany({ orderBy: { createdAt: "asc" } });
}

export function getItem(id: string): Promise<MarketItem | null> {
  return prisma.marketItem.findUnique({ where: { id } });
}

export function createItem(input: CreateMarketItemInput): Promise<MarketItem> {
  return prisma.marketItem.create({ data: input });
}

export async function updateItem(
  id: string,
  input: UpdateMarketItemInput,
): Promise<MarketItem | undefined> {
  try {
    return await prisma.marketItem.update({ where: { id }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return undefined;
    }
    throw err;
  }
}

export async function deleteItem(id: string): Promise<boolean> {
  try {
    await prisma.marketItem.delete({ where: { id } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return false;
    }
    throw err;
  }
}
