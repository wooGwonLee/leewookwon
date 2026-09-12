import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma, User } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { AuthTokenPayload, LoginInput, RegisterInput } from "../types/auth.types";

const SALT_ROUNDS = 10;

export class EmailAlreadyRegisteredError extends Error {}
export class InvalidCredentialsError extends Error {}

export async function register(input: RegisterInput): Promise<User> {
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  try {
    return await prisma.user.create({
      data: { email: input.email, passwordHash },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EmailAlreadyRegisteredError("Email is already registered");
    }
    throw err;
  }
}

export async function login(input: LoginInput): Promise<{ user: User; token: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new InvalidCredentialsError("Invalid email or password");
  }
  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError("Invalid email or password");
  }
  const token = signToken(user);
  return { user, token };
}

function signToken(user: User): string {
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, config.jwtSecret(), { expiresIn: config.jwtExpiresIn });
}
