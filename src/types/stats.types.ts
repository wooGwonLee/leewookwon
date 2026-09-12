import { OrderStatus } from "@prisma/client";

export interface StatsSummary {
  totalUsers: number;
  totalItems: number;
  totalOrders: number;
  ordersByStatus: Record<OrderStatus, number>;
  totalRevenue: number;
  lowStockThreshold: number;
  lowStockItemCount: number;
}

export interface TopSellingItem {
  marketItemId: string;
  name: string;
  totalQuantitySold: number;
  totalRevenue: number;
}
