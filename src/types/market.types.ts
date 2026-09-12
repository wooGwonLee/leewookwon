export interface MarketItem {
  id: string;
  name: string;
  price: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

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
