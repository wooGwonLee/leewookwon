import { prisma } from "../db/prisma";

export async function getAverageRatings(marketItemIds: string[]): Promise<Map<string, number>> {
  if (marketItemIds.length === 0) {
    return new Map();
  }
  const grouped = await prisma.review.groupBy({
    by: ["marketItemId"],
    where: { marketItemId: { in: marketItemIds } },
    _avg: { rating: true },
  });
  return new Map(
    grouped.map((g) => [g.marketItemId, Math.round((g._avg.rating ?? 0) * 10) / 10]),
  );
}
