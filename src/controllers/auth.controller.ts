import { Request, Response } from "express";
import * as authService from "../services/auth.service";

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    res
      .status(400)
      .json({ error: "email (string) and password (string, min 8 chars) are required" });
    return;
  }
  try {
    const user = await authService.register({ email, password });
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    if (err instanceof authService.EmailAlreadyRegisteredError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  try {
    const { user, token } = await authService.login({ email, password });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof authService.InvalidCredentialsError) {
      res.status(401).json({ error: err.message });
      return;
    }
    throw err;
  }
}
