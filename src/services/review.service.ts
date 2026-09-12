import { Prisma, Review } from "@prisma/client";
import { prisma } from "../db/prisma";
import { CreateReviewInput, UpdateReviewInput } from "../types/review.types";
import { PaginatedResult } from "../types/market.types";

export class MarketItemNotFoundError extends Error {}
export class ReviewAlreadyExistsError extends Error {}
export class ReviewNotFoundError extends Error {}
export class ForbiddenReviewActionError extends Error {}

export async function createReview(
  userId: string,
  marketItemId: string,
  input: CreateReviewInput,
): Promise<Review> {
  const item = await prisma.marketItem.findUnique({ where: { id: marketItemId } });
  if (!item) {
    throw new MarketItemNotFoundError("Item not found");
  }
  try {
    return await prisma.review.create({
      data: { userId, marketItemId, rating: input.rating, comment: input.comment },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ReviewAlreadyExistsError("You have already reviewed this item");
    }
    throw err;
  }
}

export async function updateReview(
  userId: string,
  reviewId: string,
  input: UpdateReviewInput,
): Promise<Review> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) {
    throw new ReviewNotFoundError("Review not found");
  }
  if (review.userId !== userId) {
    throw new ForbiddenReviewActionError("You can only edit your own review");
  }
  return prisma.review.update({ where: { id: reviewId }, data: input });
}

export async function deleteReview(
  userId: string,
  userRole: string,
  reviewId: string,
): Promise<void> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) {
    throw new ReviewNotFoundError("Review not found");
  }
  if (review.userId !== userId && userRole !== "ADMIN") {
    throw new ForbiddenReviewActionError("You can only delete your own review");
  }
  await prisma.review.delete({ where: { id: reviewId } });
}

export async function listReviewsForItem(
  marketItemId: string,
  page: number,
  limit: number,
): Promise<PaginatedResult<Review>> {
  const where = { marketItemId };
  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.review.count({ where }),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}
