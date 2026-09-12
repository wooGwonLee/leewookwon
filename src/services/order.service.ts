import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  CreateOrderItemInput,
  OrderWithItems,
} from "../types/order.types";
import { PaginatedResult } from "../types/market.types";
import { InsufficientStockError } from "./market.service";

export { InsufficientStockError };
export class OrderItemNotFoundError extends Error {}
export class OrderNotFoundError extends Error {}
export class ForbiddenOrderActionError extends Error {}
export class InvalidOrderTransitionError extends Error {}

const ORDER_INCLUDE = {
  items: { include: { marketItem: { select: { id: true, name: true } } } },
} satisfies Prisma.OrderInclude;

// Only these transitions are allowed; PENDING/CONFIRMED can move forward or be
// cancelled, COMPLETED/CANCELLED are terminal. Cancelling (from either state)
// restores the stock that was reserved at order creation.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function createOrder(
  userId: string,
  items: CreateOrderItemInput[],
): Promise<OrderWithItems> {
  return prisma.$transaction(async (tx) => {
    const orderItemsData: { marketItemId: string; quantity: number; priceAtOrder: number }[] = [];
    let totalPrice = 0;
    for (const { marketItemId, quantity } of items) {
      const item = await tx.marketItem.findUnique({ where: { id: marketItemId } });
      if (!item) {
        throw new OrderItemNotFoundError(`Item ${marketItemId} not found`);
      }
      // Same conditional-updateMany pattern as marketService.adjustStock: the
      // WHERE clause itself gates the decrement on stock staying non-negative,
      // so concurrent orders for the same item can't race each other negative.
      const result = await tx.marketItem.updateMany({
        where: { id: marketItemId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });
      if (result.count === 0) {
        throw new InsufficientStockError(`Insufficient stock for item ${marketItemId}`);
      }
      orderItemsData.push({ marketItemId, quantity, priceAtOrder: item.price });
      totalPrice += item.price * quantity;
    }
    return tx.order.create({
      data: { userId, totalPrice, items: { create: orderItemsData } },
      include: ORDER_INCLUDE,
    });
  });
}

export async function getOrderById(id: string): Promise<OrderWithItems | null> {
  return prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
}

export async function listOrders(
  page: number,
  limit: number,
  filters: { userId?: string } = {},
): Promise<PaginatedResult<OrderWithItems>> {
  const where: Prisma.OrderWhereInput = filters.userId ? { userId: filters.userId } : {};
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: ORDER_INCLUDE,
    }),
    prisma.order.count({ where }),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function restoreStockForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  await Promise.all(
    items.map((item) =>
      tx.marketItem.update({
        where: { id: item.marketItemId },
        data: { stock: { increment: item.quantity } },
      }),
    ),
  );
}

export async function cancelOrder(
  userId: string,
  userRole: string,
  orderId: string,
): Promise<OrderWithItems> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderNotFoundError("Order not found");
    }
    if (order.userId !== userId && userRole !== "ADMIN") {
      throw new ForbiddenOrderActionError("You can only cancel your own order");
    }
    if (order.status !== "PENDING") {
      throw new InvalidOrderTransitionError("Only a pending order can be cancelled this way");
    }
    await restoreStockForOrder(tx, orderId);
    return tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
      include: ORDER_INCLUDE,
    });
  });
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<OrderWithItems> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new OrderNotFoundError("Order not found");
    }
    if (!ALLOWED_TRANSITIONS[order.status].includes(status)) {
      throw new InvalidOrderTransitionError(
        `Cannot transition order from ${order.status} to ${status}`,
      );
    }
    if (status === "CANCELLED") {
      await restoreStockForOrder(tx, orderId);
    }
    return tx.order.update({ where: { id: orderId }, data: { status }, include: ORDER_INCLUDE });
  });
}
