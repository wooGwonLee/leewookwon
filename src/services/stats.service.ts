import { OrderStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { StatsSummary, TopSellingItem } from "../types/stats.types";

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export async function getSummary(
  lowStockThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): Promise<StatsSummary> {
  const [totalUsers, totalItems, ordersByStatusRaw, completedRevenue, lowStockItemCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.marketItem.count(),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.order.aggregate({ where: { status: "COMPLETED" }, _sum: { totalPrice: true } }),
      prisma.marketItem.count({ where: { stock: { lte: lowStockThreshold } } }),
    ]);

  const ordersByStatus: Record<OrderStatus, number> = {
    PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  let totalOrders = 0;
  for (const row of ordersByStatusRaw) {
    ordersByStatus[row.status] = row._count._all;
    totalOrders += row._count._all;
  }

  return {
    totalUsers,
    totalItems,
    totalOrders,
    ordersByStatus,
    // "Revenue" only counts orders that actually completed, not pending/confirmed
    // reservations or cancelled ones.
    totalRevenue: completedRevenue._sum.totalPrice ?? 0,
    lowStockThreshold,
    lowStockItemCount,
  };
}

export async function getTopSellingItems(limit: number): Promise<TopSellingItem[]> {
  // A cancelled order's items were never actually sold, so they're excluded from
  // "top selling" — everything else (pending/confirmed/completed) counts as a sale.
  const rows = await prisma.orderItem.findMany({
    where: { order: { status: { not: "CANCELLED" } } },
    select: { marketItemId: true, quantity: true, priceAtOrder: true },
  });

  const totals = new Map<string, { quantity: number; revenue: number }>();
  for (const row of rows) {
    const entry = totals.get(row.marketItemId) ?? { quantity: 0, revenue: 0 };
    entry.quantity += row.quantity;
    entry.revenue += row.quantity * row.priceAtOrder;
    totals.set(row.marketItemId, entry);
  }

  const top = [...totals.entries()]
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, limit);

  const items = await prisma.marketItem.findMany({
    where: { id: { in: top.map(([marketItemId]) => marketItemId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(items.map((item) => [item.id, item.name]));

  return top.map(([marketItemId, { quantity, revenue }]) => ({
    marketItemId,
    name: nameById.get(marketItemId) ?? "",
    totalQuantitySold: quantity,
    totalRevenue: revenue,
  }));
}
