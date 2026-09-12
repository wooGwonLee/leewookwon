import express, { Express, NextFunction, Request, Response } from "express";
import authRoutes from "./routes/auth.routes";
import marketRoutes from "./routes/market.routes";
import favoritesRoutes from "./routes/favorites.routes";
import usersRoutes from "./routes/users.routes";
import { ensureUploadDirs, UPLOADS_ROOT } from "./upload";

export function createApp(): Express {
  ensureUploadDirs();

  const app = express();
  app.use(express.json());
  app.use("/uploads", express.static(UPLOADS_ROOT));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/market/items", marketRoutes);
  app.use("/api/market/favorites", favoritesRoutes);
  app.use("/api/users", usersRoutes);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
