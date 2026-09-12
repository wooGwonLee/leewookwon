import { Role, User } from "@prisma/client";
import { prisma } from "../db/prisma";
import { PaginatedResult } from "../types/market.types";

export class UserNotFoundError extends Error {}
export class SelfRoleChangeError extends Error {}

export type SafeUser = Omit<User, "passwordHash">;

function omitPasswordHash(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function listUsers(
  page: number,
  limit: number,
): Promise<PaginatedResult<SafeUser>> {
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count(),
  ]);
  return {
    items: users.map(omitPasswordHash),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function updateUserRole(
  requestingUserId: string,
  targetUserId: string,
  role: Role,
): Promise<SafeUser> {
  if (requestingUserId === targetUserId) {
    throw new SelfRoleChangeError("You cannot change your own role");
  }
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) {
    throw new UserNotFoundError("User not found");
  }
  const updated = await prisma.user.update({ where: { id: targetUserId }, data: { role } });
  return omitPasswordHash(updated);
}
