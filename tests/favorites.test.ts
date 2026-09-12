import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";

const app = createApp();

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post("/api/auth/register").send({ email, password: "password123" });
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

describe("Favorites API", () => {
  it("rejects favoriting without authentication", async () => {
    const userToken = await registerAndLogin("owner@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Gadget", price: 100 });

    const res = await request(app).post(`/api/market/items/${createRes.body.id}/favorite`);
    expect(res.status).toBe(401);
  });

  it("returns 404 favoriting a non-existent item", async () => {
    const userToken = await registerAndLogin("favuser1@example.com");
    const res = await request(app)
      .post("/api/market/items/00000000-0000-0000-0000-000000000000/favorite")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(404);
  });

  it("adds and removes a favorite, and is idempotent on repeat add", async () => {
    const userToken = await registerAndLogin("favuser2@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;

    const addRes = await request(app)
      .post(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(addRes.status).toBe(201);
    expect(addRes.body.favorited).toBe(true);

    const addAgainRes = await request(app)
      .post(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(addAgainRes.status).toBe(200);

    const statusRes = await request(app)
      .get(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(statusRes.body).toEqual({ favorited: true, favoriteCount: 1 });

    const removeRes = await request(app)
      .delete(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(removeRes.status).toBe(204);

    const removeAgainRes = await request(app)
      .delete(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(removeAgainRes.status).toBe(404);

    const statusAfterRemoveRes = await request(app)
      .get(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(statusAfterRemoveRes.body).toEqual({ favorited: false, favoriteCount: 0 });
  });

  it("reflects favoriteCount on the item detail and list endpoints", async () => {
    const ownerToken = await registerAndLogin("favowner@example.com");
    const alice = await registerAndLogin("alice@example.com");
    const bob = await registerAndLogin("bob@example.com");

    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Popular Gadget", price: 100 });
    const itemId = createRes.body.id;
    expect(createRes.body.favoriteCount).toBe(0);

    await request(app)
      .post(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${alice}`);
    await request(app)
      .post(`/api/market/items/${itemId}/favorite`)
      .set("Authorization", `Bearer ${bob}`);

    const detailRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(detailRes.body.favoriteCount).toBe(2);

    const listRes = await request(app).get("/api/market/items");
    expect(listRes.body.items[0].favoriteCount).toBe(2);
  });

  it("lists the current user's favorited items, paginated", async () => {
    const ownerToken = await registerAndLogin("favowner2@example.com");
    const userToken = await registerAndLogin("favuser3@example.com");

    const items = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post("/api/market/items")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: `Item ${i}`, price: i });
      items.push(res.body.id);
    }

    for (const itemId of items) {
      await request(app)
        .post(`/api/market/items/${itemId}/favorite`)
        .set("Authorization", `Bearer ${userToken}`);
    }

    const res = await request(app)
      .get("/api/market/favorites")
      .set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0].favoriteCount).toBe(1);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });

    const paged = await request(app)
      .get("/api/market/favorites?page=1&limit=2")
      .set("Authorization", `Bearer ${userToken}`);
    expect(paged.body.items).toHaveLength(2);
    expect(paged.body.pagination.totalPages).toBe(2);
  });

  it("rejects listing my favorites without authentication", async () => {
    const res = await request(app).get("/api/market/favorites");
    expect(res.status).toBe(401);
  });
});
