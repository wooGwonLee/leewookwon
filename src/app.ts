import express, { Express, NextFunction, Request, Response } from "express";
import authRoutes from "./routes/auth.routes";
import marketRoutes from "./routes/market.routes";
import favoritesRoutes from "./routes/favorites.routes";

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/market/items", marketRoutes);
  app.use("/api/market/favorites", favoritesRoutes);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
