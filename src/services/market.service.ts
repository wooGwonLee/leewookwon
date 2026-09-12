import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  CreateMarketItemInput,
  MarketItemFilters,
  MarketItemWithFavoriteCount,
  PaginatedResult,
  UpdateMarketItemInput,
} from "../types/market.types";

type ItemWithFavoriteCount = Prisma.MarketItemGetPayload<{
  include: { _count: { select: { favorites: true } } };
}>;

function withFavoriteCount(item: ItemWithFavoriteCount): MarketItemWithFavoriteCount {
  const { _count, ...rest } = item;
  return { ...rest, favoriteCount: _count.favorites };
}

function buildWhere(filters: MarketItemFilters): Prisma.MarketItemWhereInput {
  const where: Prisma.MarketItemWhereInput = {};

  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.price = {
      ...(filters.minPrice !== undefined && { gte: filters.minPrice }),
      ...(filters.maxPrice !== undefined && { lte: filters.maxPrice }),
    };
  }

  return where;
}

export async function listItems(
  page: number,
  limit: number,
  filters: MarketItemFilters = {},
): Promise<PaginatedResult<MarketItemWithFavoriteCount>> {
  const where = buildWhere(filters);
  const [items, total] = await Promise.all([
    prisma.marketItem.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { _count: { select: { favorites: true } } },
    }),
    prisma.marketItem.count({ where }),
  ]);
  return {
    items: items.map(withFavoriteCount),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getItem(id: string): Promise<MarketItemWithFavoriteCount | null> {
  // Raw update so viewing an item bumps viewCount without touching the
  // @updatedAt-managed updatedAt column (which should reflect content edits).
  const affectedRows = await prisma.$executeRaw`
    UPDATE "market_items" SET "viewCount" = "viewCount" + 1 WHERE "id" = ${id}
  `;
  if (affectedRows === 0) {
    return null;
  }
  const item = await prisma.marketItem.findUnique({
    where: { id },
    include: { _count: { select: { favorites: true } } },
  });
  return item ? withFavoriteCount(item) : null;
}

export function createItem(input: CreateMarketItemInput): Promise<MarketItemWithFavoriteCount> {
  return prisma.marketItem
    .create({ data: input, include: { _count: { select: { favorites: true } } } })
    .then(withFavoriteCount);
}

export async function updateItem(
  id: string,
  input: UpdateMarketItemInput,
): Promise<MarketItemWithFavoriteCount | undefined> {
  try {
    const item = await prisma.marketItem.update({
      where: { id },
      data: input,
      include: { _count: { select: { favorites: true } } },
    });
    return withFavoriteCount(item);
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
