import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { CreateOptionInput, MarketItemOption, UpdateOptionInput } from "../types/option.types";

export class MarketItemNotFoundError extends Error {}
export class OptionNameConflictError extends Error {}
export class OptionNotFoundError extends Error {}
export class OptionHasOrdersError extends Error {}

export async function createOption(
  marketItemId: string,
  input: CreateOptionInput,
): Promise<MarketItemOption> {
  const item = await prisma.marketItem.findUnique({ where: { id: marketItemId } });
  if (!item) {
    throw new MarketItemNotFoundError("Item not found");
  }
  try {
    return await prisma.marketItemOption.create({
      data: {
        marketItemId,
        name: input.name,
        priceDelta: input.priceDelta ?? 0,
        stock: input.stock ?? 0,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new OptionNameConflictError("An option with this name already exists for this item");
    }
    throw err;
  }
}

export async function updateOption(
  marketItemId: string,
  optionId: string,
  input: UpdateOptionInput,
): Promise<MarketItemOption> {
  const existing = await prisma.marketItemOption.findUnique({ where: { id: optionId } });
  if (!existing || existing.marketItemId !== marketItemId) {
    throw new OptionNotFoundError("Option not found");
  }
  try {
    return await prisma.marketItemOption.update({ where: { id: optionId }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new OptionNameConflictError("An option with this name already exists for this item");
    }
    throw err;
  }
}

export async function deleteOption(marketItemId: string, optionId: string): Promise<void> {
  const existing = await prisma.marketItemOption.findUnique({ where: { id: optionId } });
  if (!existing || existing.marketItemId !== marketItemId) {
    throw new OptionNotFoundError("Option not found");
  }
  try {
    await prisma.marketItemOption.delete({ where: { id: optionId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new OptionHasOrdersError("Cannot delete an option that has existing orders");
    }
    throw err;
  }
}
