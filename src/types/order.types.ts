import { Order, OrderItem, OrderStatus } from "@prisma/client";

export type { Order, OrderItem, OrderStatus };

export interface CreateOrderItemInput {
  marketItemId: string;
  quantity: number;
}

export type OrderItemWithMarketItem = OrderItem & {
  marketItem: { id: string; name: string };
};

export type OrderWithItems = Order & { items: OrderItemWithMarketItem[] };
