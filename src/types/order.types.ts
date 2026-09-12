import { Order, OrderItem, OrderStatus } from "@prisma/client";

export type { Order, OrderItem, OrderStatus };

export interface CreateOrderItemInput {
  marketItemId: string;
  marketItemOptionId?: string;
  quantity: number;
}

export type OrderItemWithMarketItem = OrderItem & {
  marketItem: { id: string; name: string };
  marketItemOption: { id: string; name: string } | null;
};

export type OrderWithItems = Order & { items: OrderItemWithMarketItem[] };
