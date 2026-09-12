import fs from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  CreateMarketItemInput,
  MarketItemFilters,
  MarketItemSort,
  MarketItemWithAggregates,
  PaginatedResult,
  UpdateMarketItemInput,
} from "../types/market.types";
import { getAverageRatings } from "./rating.util";
import { MARKET_ITEM_IMAGES_DIR } from "../upload";

type ItemWithCounts = Prisma.MarketItemGetPayload<{
  include: {
    _count: { select: { favorites: true; reviews: true } };
    images: true;
    category: true;
    options: true;
  };
}>;

const ITEM_COUNTS_INCLUDE = {
  _count: { select: { favorites: true, reviews: true } },
  images: { orderBy: { createdAt: "asc" } },
  category: true,
  options: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.MarketItemInclude;

export class InvalidCategoryError extends Error {}
export class InsufficientStockError extends Error {}
export class ItemHasOrdersError extends Error {}

function withAggregates(
  item: ItemWithCounts,
  averageRatings: Map<string, number>,
): MarketItemWithAggregates {
  const { _count, ...rest } = item;
  return {
    ...rest,
    favoriteCount: _count.favorites,
    reviewCount: _count.reviews,
    averageRating: averageRatings.get(item.id) ?? null,
  };
}

async function fetchItemWithAggregates(id: string): Promise<MarketItemWithAggregates | undefined> {
  const item = await prisma.marketItem.findUnique({ where: { id }, include: ITEM_COUNTS_INCLUDE });
  if (!item) {
    return undefined;
  }
  const averageRatings = await getAverageRatings([id]);
  return withAggregates(item, averageRatings);
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

  if (filters.categoryId !== undefined) {
    where.categoryId = filters.categoryId;
  }

  if (filters.inStock || filters.maxStock !== undefined) {
    where.stock = {
      ...(filters.inStock && { gt: 0 }),
      ...(filters.maxStock !== undefined && { lte: filters.maxStock }),
    };
  }

  return where;
}

function buildOrderBy(sort: MarketItemSort): Prisma.MarketItemOrderByWithRelationInput[] {
  const { sortBy, sortOrder } = sort;
  const primary: Prisma.MarketItemOrderByWithRelationInput =
    sortBy === "favoriteCount"
      ? { favorites: { _count: sortOrder } }
      : sortBy === "reviewCount"
        ? { reviews: { _count: sortOrder } }
        : { [sortBy]: sortOrder };
  // A tiebreaker keeps pagination stable/deterministic when the sort field
  // has duplicate values (e.g. many items with the same price).
  return [primary, { id: "asc" }];
}

const DEFAULT_SORT: MarketItemSort = { sortBy: "createdAt", sortOrder: "asc" };

export async function listItems(
  page: number,
  limit: number,
  filters: MarketItemFilters = {},
  sort: MarketItemSort = DEFAULT_SORT,
): Promise<PaginatedResult<MarketItemWithAggregates>> {
  const where = buildWhere(filters);
  const [items, total] = await Promise.all([
    prisma.marketItem.findMany({
      where,
      orderBy: buildOrderBy(sort),
      skip: (page - 1) * limit,
      take: limit,
      include: ITEM_COUNTS_INCLUDE,
    }),
    prisma.marketItem.count({ where }),
  ]);
  const averageRatings = await getAverageRatings(items.map((i) => i.id));
  return {
    items: items.map((item) => withAggregates(item, averageRatings)),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getItem(id: string): Promise<MarketItemWithAggregates | null> {
  // Raw update so viewing an item bumps viewCount without touching the
  // @updatedAt-managed updatedAt column (which should reflect content edits).
  const affectedRows = await prisma.$executeRaw`
    UPDATE "market_items" SET "viewCount" = "viewCount" + 1 WHERE "id" = ${id}
  `;
  if (affectedRows === 0) {
    return null;
  }
  return (await fetchItemWithAggregates(id)) ?? null;
}

export async function createItem(
  input: CreateMarketItemInput,
): Promise<MarketItemWithAggregates> {
  try {
    const item = await prisma.marketItem.create({ data: input, include: ITEM_COUNTS_INCLUDE });
    return withAggregates(item, new Map());
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new InvalidCategoryError("categoryId does not refer to an existing category");
    }
    throw err;
  }
}

export async function updateItem(
  id: string,
  input: UpdateMarketItemInput,
): Promise<MarketItemWithAggregates | undefined> {
  try {
    const item = await prisma.marketItem.update({
      where: { id },
      data: input,
      include: ITEM_COUNTS_INCLUDE,
    });
    const averageRatings = await getAverageRatings([id]);
    return withAggregates(item, averageRatings);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") {
        return undefined;
      }
      if (err.code === "P2003") {
        throw new InvalidCategoryError("categoryId does not refer to an existing category");
      }
    }
    throw err;
  }
}

export async function adjustStock(
  id: string,
  delta: number,
): Promise<MarketItemWithAggregates | undefined> {
  // A single conditional UPDATE (stock + delta as the new value, gated on the
  // resulting stock never going negative) so concurrent adjustments can't
  // race each other into an inconsistent stock count.
  const result = await prisma.marketItem.updateMany({
    where: delta < 0 ? { id, stock: { gte: -delta } } : { id },
    data: { stock: { increment: delta } },
  });
  if (result.count > 0) {
    return fetchItemWithAggregates(id);
  }
  const exists = await prisma.marketItem.findUnique({ where: { id } });
  if (!exists) {
    return undefined;
  }
  throw new InsufficientStockError("Adjustment would make stock negative");
}

export async function deleteItem(id: string): Promise<boolean> {
  // Fetch image filenames before the cascade delete removes the DB rows,
  // so the files on disk can be cleaned up too (otherwise they're orphaned).
  const images = await prisma.marketItemImage.findMany({ where: { marketItemId: id } });
  try {
    await prisma.marketItem.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") {
        return false;
      }
      if (err.code === "P2003") {
        throw new ItemHasOrdersError("Cannot delete an item that has existing orders");
      }
    }
    throw err;
  }
  await Promise.all(
    images.map((image) =>
      fs.unlink(path.join(MARKET_ITEM_IMAGES_DIR, image.filename)).catch(() => undefined),
    ),
  );
  return true;
}
