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

export const SORTABLE_FIELDS = [
  "createdAt",
  "price",
  "viewCount",
  "name",
  "favoriteCount",
  "reviewCount",
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];
export type SortOrder = "asc" | "desc";

export interface MarketItemSort {
  sortBy: SortableField;
  sortOrder: SortOrder;
}

export type MarketItemWithAggregates = MarketItem & {
  favoriteCount: number;
  reviewCount: number;
  averageRating: number | null;
  images: MarketItemImage[];
};
