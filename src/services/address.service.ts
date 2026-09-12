import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { Address, CreateAddressInput, UpdateAddressInput } from "../types/address.types";
import { PaginatedResult } from "../types/market.types";

export class AddressNotFoundError extends Error {}
export class ForbiddenAddressActionError extends Error {}

type TxClient = Prisma.TransactionClient;

async function unsetOtherDefaults(
  tx: TxClient,
  userId: string,
  excludeId?: string,
): Promise<void> {
  await tx.address.updateMany({
    where: { userId, isDefault: true, ...(excludeId && { id: { not: excludeId } }) },
    data: { isDefault: false },
  });
}

export async function createAddress(
  userId: string,
  input: CreateAddressInput,
): Promise<Address> {
  const data = { userId, ...input, isDefault: input.isDefault ?? false };
  if (!data.isDefault) {
    return prisma.address.create({ data });
  }
  // Only one address per user may be the default, so setting this one requires
  // clearing the flag on any existing default in the same transaction.
  return prisma.$transaction(async (tx) => {
    await unsetOtherDefaults(tx, userId);
    return tx.address.create({ data });
  });
}

export async function listAddresses(
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedResult<Address>> {
  const where = { userId };
  const [items, total] = await Promise.all([
    prisma.address.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.address.count({ where }),
  ]);
  return {
    items,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getAddress(userId: string, addressId: string): Promise<Address> {
  const address = await prisma.address.findUnique({ where: { id: addressId } });
  if (!address) {
    throw new AddressNotFoundError("Address not found");
  }
  if (address.userId !== userId) {
    throw new ForbiddenAddressActionError("You can only view your own address");
  }
  return address;
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<Address> {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing) {
    throw new AddressNotFoundError("Address not found");
  }
  if (existing.userId !== userId) {
    throw new ForbiddenAddressActionError("You can only edit your own address");
  }
  if (!input.isDefault) {
    return prisma.address.update({ where: { id: addressId }, data: input });
  }
  return prisma.$transaction(async (tx) => {
    await unsetOtherDefaults(tx, userId, addressId);
    return tx.address.update({ where: { id: addressId }, data: input });
  });
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const existing = await prisma.address.findUnique({ where: { id: addressId } });
  if (!existing) {
    throw new AddressNotFoundError("Address not found");
  }
  if (existing.userId !== userId) {
    throw new ForbiddenAddressActionError("You can only delete your own address");
  }
  // Order.shippingAddressId is onDelete: SetNull, so deleting an address that's
  // been used on a past order just detaches it (the order keeps its own
  // shippingSnapshot) rather than being blocked like item/option deletion is.
  await prisma.address.delete({ where: { id: addressId } });
}
