import { Role } from "@prisma/client";

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: Role;
}
