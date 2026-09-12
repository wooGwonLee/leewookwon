import { Request, Response } from "express";
import * as reviewService from "../services/review.service";
import { parsePagination } from "../utils/pagination";

function parseRatingAndComment(
  body: unknown,
): { rating: number; comment?: string } | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { rating, comment } = body as Record<string, unknown>;
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
    return undefined;
  }
  if (comment !== undefined && typeof comment !== "string") {
    return undefined;
  }
  return { rating: rating as number, comment: comment as string | undefined };
}

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = parseRatingAndComment(req.body);
  if (!parsed) {
    res.status(400).json({ error: "rating (integer 1-5) is required; comment must be a string" });
    return;
  }
  try {
    const review = await reviewService.createReview(req.user!.sub, req.params.id, parsed);
    res.status(201).json(review);
  } catch (err) {
    if (err instanceof reviewService.MarketItemNotFoundError) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    if (err instanceof reviewService.ReviewAlreadyExistsError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function update(req: Request, res: Response): Promise<void> {
  const { rating, comment } = req.body ?? {};
  if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    res.status(400).json({ error: "rating must be an integer 1-5" });
    return;
  }
  if (comment !== undefined && typeof comment !== "string") {
    res.status(400).json({ error: "comment must be a string" });
    return;
  }
  try {
    const review = await reviewService.updateReview(req.user!.sub, req.params.reviewId, {
      rating,
      comment,
    });
    res.json(review);
  } catch (err) {
    if (err instanceof reviewService.ReviewNotFoundError) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    if (err instanceof reviewService.ForbiddenReviewActionError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    await reviewService.deleteReview(req.user!.sub, req.user!.role, req.params.reviewId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof reviewService.ReviewNotFoundError) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    if (err instanceof reviewService.ForbiddenReviewActionError) {
      res.status(403).json({ error: err.message });
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
  res.json(
    await reviewService.listReviewsForItem(req.params.id, pagination.page, pagination.limit),
  );
}
