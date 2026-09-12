import { MarketItem, MarketItemImage } from "@prisma/client";

export type { MarketItem, MarketItemImage };

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

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface MarketItemFilters {
  q?: string;
  minPrice?: number;
  maxPrice?: number;
}

export type MarketItemWithAggregates = MarketItem & {
  favoriteCount: number;
  reviewCount: number;
  averageRating: number | null;
  images: MarketItemImage[];
};
