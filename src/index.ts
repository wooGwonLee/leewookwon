import { createApp } from "./app";
import { prisma } from "./db/prisma";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Market API server listening on port ${PORT}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
