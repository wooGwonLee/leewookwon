import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  CreateMarketItemInput,
  MarketItem,
  PaginatedResult,
  UpdateMarketItemInput,
} from "../types/market.types";

export async function listItems(page: number, limit: number): Promise<PaginatedResult<MarketItem>> {
  const [items, total] = await Promise.all([
    prisma.marketItem.findMany({
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.marketItem.count(),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
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
