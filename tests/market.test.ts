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
  it("returns an empty page initially", async () => {
    const res = await request(app).get("/api/market/items");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
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

  describe("pagination", () => {
    beforeEach(async () => {
      const userToken = await registerAndLogin("paginator@example.com", "USER");
      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/api/market/items")
          .set("Authorization", `Bearer ${userToken}`)
          .send({ name: `Item ${i}`, price: i });
      }
    });

    it("applies default page and limit", async () => {
      const res = await request(app).get("/api/market/items");
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(5);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 5, totalPages: 1 });
    });

    it("paginates using page and limit query params", async () => {
      const firstPage = await request(app).get("/api/market/items?page=1&limit=2");
      expect(firstPage.status).toBe(200);
      expect(firstPage.body.items).toHaveLength(2);
      expect(firstPage.body.pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });

      const secondPage = await request(app).get("/api/market/items?page=2&limit=2");
      expect(secondPage.body.items).toHaveLength(2);
      expect(secondPage.body.items[0].name).toBe("Item 2");

      const lastPage = await request(app).get("/api/market/items?page=3&limit=2");
      expect(lastPage.body.items).toHaveLength(1);
    });

    it("caps limit at 100 and rejects non-positive-integer params", async () => {
      const overLimit = await request(app).get("/api/market/items?limit=1000");
      expect(overLimit.status).toBe(200);
      expect(overLimit.body.pagination.limit).toBe(100);

      const invalidPage = await request(app).get("/api/market/items?page=0");
      expect(invalidPage.status).toBe(400);

      const nonNumericLimit = await request(app).get("/api/market/items?limit=abc");
      expect(nonNumericLimit.status).toBe(400);
    });
  });
});
