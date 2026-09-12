import { Request, Response } from "express";
import { OrderStatus } from "@prisma/client";
import * as orderService from "../services/order.service";
import { parsePagination } from "../utils/pagination";
import { CreateOrderItemInput } from "../types/order.types";

const ORDER_STATUS_VALUES = Object.values(OrderStatus);

function parseOrderItems(body: unknown): CreateOrderItemInput[] | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { items } = body as Record<string, unknown>;
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const parsed: CreateOrderItemInput[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) {
      return undefined;
    }
    const { marketItemId, marketItemOptionId, quantity } = raw as Record<string, unknown>;
    if (typeof marketItemId !== "string" || marketItemId.trim() === "") {
      return undefined;
    }
    if (
      marketItemOptionId !== undefined &&
      (typeof marketItemOptionId !== "string" || marketItemOptionId.trim() === "")
    ) {
      return undefined;
    }
    if (!Number.isInteger(quantity) || (quantity as number) < 1) {
      return undefined;
    }
    const dedupeKey = `${marketItemId}::${marketItemOptionId ?? ""}`;
    if (seen.has(dedupeKey)) {
      return undefined;
    }
    seen.add(dedupeKey);
    parsed.push({
      marketItemId,
      marketItemOptionId: marketItemOptionId as string | undefined,
      quantity: quantity as number,
    });
  }
  return parsed;
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = parseOrderItems(req.body);
  if (!parsed) {
    res.status(400).json({
      error:
        "items must be a non-empty array of { marketItemId: string, marketItemOptionId?: string, quantity: positive integer } with no duplicate marketItemId+marketItemOptionId entries",
    });
    return;
  }
  try {
    const order = await orderService.createOrder(req.user!.sub, parsed);
    res.status(201).json(order);
  } catch (err) {
    if (err instanceof orderService.OrderItemNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof orderService.InsufficientStockError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function list(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  const filters = req.user!.role === "ADMIN" ? {} : { userId: req.user!.sub };
  res.json(await orderService.listOrders(pagination.page, pagination.limit, filters));
}

export async function get(req: Request, res: Response): Promise<void> {
  const order = await orderService.getOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (order.userId !== req.user!.sub && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "You can only view your own order" });
    return;
  }
  res.json(order);
}

export async function cancel(req: Request, res: Response): Promise<void> {
  try {
    const order = await orderService.cancelOrder(req.user!.sub, req.user!.role, req.params.id);
    res.json(order);
  } catch (err) {
    if (err instanceof orderService.OrderNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof orderService.ForbiddenOrderActionError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof orderService.InvalidOrderTransitionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const { status } = req.body ?? {};
  if (typeof status !== "string" || !ORDER_STATUS_VALUES.includes(status as OrderStatus)) {
    res.status(400).json({ error: `status must be one of: ${ORDER_STATUS_VALUES.join(", ")}` });
    return;
  }
  try {
    const order = await orderService.updateOrderStatus(req.params.id, status as OrderStatus);
    res.json(order);
  } catch (err) {
    if (err instanceof orderService.OrderNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof orderService.InvalidOrderTransitionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}
