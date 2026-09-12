import { Request, Response } from "express";
import { Role } from "@prisma/client";
import * as userService from "../services/user.service";
import { parsePagination } from "../utils/pagination";

const VALID_ROLES: Role[] = ["USER", "ADMIN"];

export async function list(req: Request, res: Response): Promise<void> {
  const pagination = parsePagination(req.query as Record<string, unknown>);
  if (!pagination) {
    res.status(400).json({ error: "page and limit must be positive integers" });
    return;
  }
  res.json(await userService.listUsers(pagination.page, pagination.limit));
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  const { role } = req.body ?? {};
  if (typeof role !== "string" || !VALID_ROLES.includes(role as Role)) {
    res.status(400).json({ error: "role must be one of: USER, ADMIN" });
    return;
  }
  try {
    const user = await userService.updateUserRole(req.user!.sub, req.params.id, role as Role);
    res.json(user);
  } catch (err) {
    if (err instanceof userService.UserNotFoundError) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (err instanceof userService.SelfRoleChangeError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
}
