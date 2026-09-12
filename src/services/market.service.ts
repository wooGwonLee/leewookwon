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
  include: { _count: { select: { favorites: true; reviews: true } }; images: true };
}>;

const ITEM_COUNTS_INCLUDE = {
  _count: { select: { favorites: true, reviews: true } },
  images: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.MarketItemInclude;

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
  const item = await prisma.marketItem.findUnique({
    where: { id },
    include: ITEM_COUNTS_INCLUDE,
  });
  if (!item) {
    return null;
  }
  const averageRatings = await getAverageRatings([id]);
  return withAggregates(item, averageRatings);
}

export async function createItem(
  input: CreateMarketItemInput,
): Promise<MarketItemWithAggregates> {
  const item = await prisma.marketItem.create({ data: input, include: ITEM_COUNTS_INCLUDE });
  return withAggregates(item, new Map());
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return undefined;
    }
    throw err;
  }
}

export async function deleteItem(id: string): Promise<boolean> {
  // Fetch image filenames before the cascade delete removes the DB rows,
  // so the files on disk can be cleaned up too (otherwise they're orphaned).
  const images = await prisma.marketItemImage.findMany({ where: { marketItemId: id } });
  try {
    await prisma.marketItem.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return false;
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
