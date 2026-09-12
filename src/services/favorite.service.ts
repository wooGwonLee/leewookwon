import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { MarketItemWithAggregates, PaginatedResult } from "../types/market.types";
import { getAverageRatings } from "./rating.util";

export class MarketItemNotFoundError extends Error {}

export async function addFavorite(
  userId: string,
  marketItemId: string,
): Promise<{ created: boolean }> {
  const item = await prisma.marketItem.findUnique({ where: { id: marketItemId } });
  if (!item) {
    throw new MarketItemNotFoundError("Item not found");
  }
  try {
    await prisma.favorite.create({ data: { userId, marketItemId } });
    return { created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { created: false };
    }
    throw err;
  }
}

export async function removeFavorite(userId: string, marketItemId: string): Promise<boolean> {
  try {
    await prisma.favorite.delete({
      where: { userId_marketItemId: { userId, marketItemId } },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return false;
    }
    throw err;
  }
}

export function countFavorites(marketItemId: string): Promise<number> {
  return prisma.favorite.count({ where: { marketItemId } });
}

export async function isFavorited(userId: string, marketItemId: string): Promise<boolean> {
  const favorite = await prisma.favorite.findUnique({
    where: { userId_marketItemId: { userId, marketItemId } },
  });
  return favorite !== null;
}

export async function listUserFavorites(
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedResult<MarketItemWithAggregates>> {
  const where = { userId };
  const [favorites, total] = await Promise.all([
    prisma.favorite.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        marketItem: {
          include: {
            _count: { select: { favorites: true, reviews: true } },
            images: { orderBy: { createdAt: "asc" } },
          },
        },
      },
    }),
    prisma.favorite.count({ where }),
  ]);

  const averageRatings = await getAverageRatings(favorites.map((f) => f.marketItem.id));

  return {
    items: favorites.map((f) => {
      const { _count, ...rest } = f.marketItem;
      return {
        ...rest,
        favoriteCount: _count.favorites,
        reviewCount: _count.reviews,
        averageRating: averageRatings.get(f.marketItem.id) ?? null,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}
