import { Category, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { PaginatedResult } from "../types/market.types";
import { CreateCategoryInput, UpdateCategoryInput } from "../types/category.types";

export class CategoryNotFoundError extends Error {}
export class CategoryNameTakenError extends Error {}

export async function listCategories(
  page: number,
  limit: number,
): Promise<PaginatedResult<Category>> {
  const [items, total] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.category.count(),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  try {
    return await prisma.category.create({ data: { name: input.name } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CategoryNameTakenError("A category with this name already exists");
    }
    throw err;
  }
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryInput,
): Promise<Category> {
  try {
    return await prisma.category.update({ where: { id }, data: { name: input.name } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") {
        throw new CategoryNotFoundError("Category not found");
      }
      if (err.code === "P2002") {
        throw new CategoryNameTakenError("A category with this name already exists");
      }
    }
    throw err;
  }
}

export async function deleteCategory(id: string): Promise<boolean> {
  try {
    await prisma.category.delete({ where: { id } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return false;
    }
    throw err;
  }
}

export async function categoryExists(id: string): Promise<boolean> {
  const category = await prisma.category.findUnique({ where: { id } });
  return category !== null;
}
