import { Review } from "@prisma/client";

export type { Review };

export interface CreateReviewInput {
  rating: number;
  comment?: string;
}

export interface UpdateReviewInput {
  rating?: number;
  comment?: string;
}
