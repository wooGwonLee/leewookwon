import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";

const app = createApp();

async function registerAndLogin(
  email: string,
  role: "USER" | "ADMIN" = "USER",
): Promise<string> {
  await request(app).post("/api/auth/register").send({ email, password: "password123" });
  if (role === "ADMIN") {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
  }
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "password123" });
  return loginRes.body.token;
}

beforeEach(async () => {
  await prisma.marketItem.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Market items API", () => {
  it("returns an empty list initially", async () => {
    const res = await request(app).get("/api/market/items");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("rejects creating an item without authentication", async () => {
    const res = await request(app)
      .post("/api/market/items")
      .send({ name: "Sample Product", price: 1000 });
    expect(res.status).toBe(401);
  });

  it("creates, fetches, updates as a regular user, and deletes as an admin", async () => {
    const userToken = await registerAndLogin("buyer@example.com", "USER");
    const adminToken = await registerAndLogin("admin@example.com", "ADMIN");

    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Sample Product", price: 1000 });
    expect(createRes.status).toBe(201);
    const { id } = createRes.body;
    expect(id).toBeDefined();

    const getRes = await request(app).get(`/api/market/items/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe("Sample Product");

    const updateRes = await request(app)
      .patch(`/api/market/items/${id}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ price: 2000 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.price).toBe(2000);

    const forbiddenDeleteRes = await request(app)
      .delete(`/api/market/items/${id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(forbiddenDeleteRes.status).toBe(403);

    const deleteRes = await request(app)
      .delete(`/api/market/items/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);

    const getAfterDeleteRes = await request(app).get(`/api/market/items/${id}`);
    expect(getAfterDeleteRes.status).toBe(404);
  });

  it("rejects invalid input on create", async () => {
    const userToken = await registerAndLogin("invalid@example.com", "USER");
    const res = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "No price" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when updating a non-existent item", async () => {
    const userToken = await registerAndLogin("updater@example.com", "USER");
    const updateRes = await request(app)
      .patch("/api/market/items/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ price: 1 });
    expect(updateRes.status).toBe(404);
  });

  it("returns 404 when an admin deletes a non-existent item", async () => {
    const adminToken = await registerAndLogin("deleter@example.com", "ADMIN");
    const deleteRes = await request(app)
      .delete("/api/market/items/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(404);
  });
});
