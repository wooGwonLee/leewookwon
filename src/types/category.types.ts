import { Category } from "@prisma/client";

export type { Category };

export interface CreateCategoryInput {
  name: string;
}

export interface UpdateCategoryInput {
  name: string;
}
