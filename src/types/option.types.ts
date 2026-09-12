import { MarketItemOption } from "@prisma/client";

export type { MarketItemOption };

export interface CreateOptionInput {
  name: string;
  priceDelta?: number;
  stock?: number;
}

export interface UpdateOptionInput {
  name?: string;
  priceDelta?: number;
  stock?: number;
}
