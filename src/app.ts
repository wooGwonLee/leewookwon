import express, { Express } from "express";
import marketRoutes from "./routes/market.routes";

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/market/items", marketRoutes);

  return app;
}
