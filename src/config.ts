import type { SignOptions } from "jsonwebtoken";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  jwtSecret: (): string => requireEnv("JWT_SECRET"),
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? "1h") as SignOptions["expiresIn"],
};
