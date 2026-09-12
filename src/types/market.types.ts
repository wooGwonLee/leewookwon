import { MarketItem } from "@prisma/client";

export type { MarketItem };

export interface CreateMarketItemInput {
  name: string;
  price: number;
  description?: string;
}

export interface UpdateMarketItemInput {
  name?: string;
  price?: number;
  description?: string;
}
