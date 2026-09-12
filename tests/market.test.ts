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
  await prisma.order.deleteMany();
  await prisma.review.deleteMany();
  await prisma.favorite.deleteMany();
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
    expect(getRes.body.viewCount).toBe(1);

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

  describe("view count", () => {
    it("starts at 0 and is not affected by listing", async () => {
      const userToken = await registerAndLogin("viewer1@example.com", "USER");
      const createRes = await request(app)
        .post("/api/market/items")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ name: "Viewed Item", price: 10 });
      expect(createRes.body.viewCount).toBe(0);

      const listRes = await request(app).get("/api/market/items");
      expect(listRes.body.items[0].viewCount).toBe(0);
    });

    it("increments by 1 on each detail fetch", async () => {
      const userToken = await registerAndLogin("viewer2@example.com", "USER");
      const createRes = await request(app)
        .post("/api/market/items")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ name: "Viewed Item 2", price: 10 });
      const { id } = createRes.body;

      const firstView = await request(app).get(`/api/market/items/${id}`);
      expect(firstView.body.viewCount).toBe(1);

      const secondView = await request(app).get(`/api/market/items/${id}`);
      expect(secondView.body.viewCount).toBe(2);

      const thirdView = await request(app).get(`/api/market/items/${id}`);
      expect(thirdView.body.viewCount).toBe(3);
    });

    it("does not bump updatedAt when only viewed", async () => {
      const userToken = await registerAndLogin("viewer3@example.com", "USER");
      const createRes = await request(app)
        .post("/api/market/items")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ name: "Viewed Item 3", price: 10 });
      const { id, updatedAt } = createRes.body;

      await request(app).get(`/api/market/items/${id}`);
      const viewRes = await request(app).get(`/api/market/items/${id}`);
      expect(viewRes.body.updatedAt).toBe(updatedAt);
    });
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

  describe("search and filtering", () => {
    let userToken: string;

    beforeEach(async () => {
      userToken = await registerAndLogin("searcher@example.com", "USER");
      const seed = [
        { name: "Red Bicycle", price: 100, description: "A sturdy commuter bike" },
        { name: "Blue Bicycle", price: 150, description: "Lightweight road bike" },
        { name: "Red Scooter", price: 80, description: "Foldable electric scooter" },
        { name: "Skateboard", price: 50, description: "Maple deck, red wheels" },
      ];
      for (const item of seed) {
        await request(app)
          .post("/api/market/items")
          .set("Authorization", `Bearer ${userToken}`)
          .send(item);
      }
    });

    it("searches by name, case-insensitively", async () => {
      const res = await request(app).get("/api/market/items?q=bicycle");
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items.map((i: { name: string }) => i.name).sort()).toEqual([
        "Blue Bicycle",
        "Red Bicycle",
      ]);
    });

    it("searches across the description field too", async () => {
      const res = await request(app).get("/api/market/items?q=red wheels");
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe("Skateboard");
    });

    it("filters by price range", async () => {
      const res = await request(app).get("/api/market/items?minPrice=80&maxPrice=100");
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { name: string }) => i.name).sort()).toEqual([
        "Red Bicycle",
        "Red Scooter",
      ]);
    });

    it("combines search and price filters", async () => {
      const res = await request(app).get("/api/market/items?q=red&maxPrice=90");
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { name: string }) => i.name).sort()).toEqual([
        "Red Scooter",
        "Skateboard",
      ]);
    });

    it("rejects invalid price filter params", async () => {
      const negative = await request(app).get("/api/market/items?minPrice=-5");
      expect(negative.status).toBe(400);

      const nonNumeric = await request(app).get("/api/market/items?maxPrice=abc");
      expect(nonNumeric.status).toBe(400);

      const inverted = await request(app).get("/api/market/items?minPrice=100&maxPrice=50");
      expect(inverted.status).toBe(400);
    });
  });

  describe("sorting", () => {
    let userToken: string;

    beforeEach(async () => {
      userToken = await registerAndLogin("sorter@example.com", "USER");
      const seed = [
        { name: "Charlie Widget", price: 30 },
        { name: "Alpha Widget", price: 10 },
        { name: "Bravo Widget", price: 20 },
      ];
      for (const item of seed) {
        await request(app)
          .post("/api/market/items")
          .set("Authorization", `Bearer ${userToken}`)
          .send(item);
      }
    });

    it("defaults to createdAt ascending (creation order)", async () => {
      const res = await request(app).get("/api/market/items");
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        "Charlie Widget",
        "Alpha Widget",
        "Bravo Widget",
      ]);
    });

    it("sorts by price ascending and descending", async () => {
      const asc = await request(app).get("/api/market/items?sortBy=price&sortOrder=asc");
      expect(asc.body.items.map((i: { price: number }) => i.price)).toEqual([10, 20, 30]);

      const desc = await request(app).get("/api/market/items?sortBy=price&sortOrder=desc");
      expect(desc.body.items.map((i: { price: number }) => i.price)).toEqual([30, 20, 10]);
    });

    it("sorts by name", async () => {
      const res = await request(app).get("/api/market/items?sortBy=name&sortOrder=asc");
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        "Alpha Widget",
        "Bravo Widget",
        "Charlie Widget",
      ]);
    });

    it("sorts by viewCount descending after viewing items different amounts", async () => {
      const listRes = await request(app).get("/api/market/items?sortBy=name&sortOrder=asc");
      const [alpha, bravo] = listRes.body.items;

      await request(app).get(`/api/market/items/${bravo.id}`);
      await request(app).get(`/api/market/items/${bravo.id}`);
      await request(app).get(`/api/market/items/${alpha.id}`);

      const res = await request(app).get("/api/market/items?sortBy=viewCount&sortOrder=desc");
      expect(res.body.items[0].name).toBe("Bravo Widget");
    });

    it("sorts by favoriteCount descending", async () => {
      const listRes = await request(app).get("/api/market/items?sortBy=name&sortOrder=asc");
      const [alpha] = listRes.body.items;

      await request(app)
        .post(`/api/market/items/${alpha.id}/favorite`)
        .set("Authorization", `Bearer ${userToken}`);

      const res = await request(app).get("/api/market/items?sortBy=favoriteCount&sortOrder=desc");
      expect(res.body.items[0].name).toBe("Alpha Widget");
      expect(res.body.items[0].favoriteCount).toBe(1);
    });

    it("rejects an invalid sortBy or sortOrder", async () => {
      const badField = await request(app).get("/api/market/items?sortBy=nope");
      expect(badField.status).toBe(400);

      const badOrder = await request(app).get("/api/market/items?sortBy=price&sortOrder=up");
      expect(badOrder.status).toBe(400);
    });
  });
});
