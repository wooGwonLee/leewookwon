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

describe("Reviews API", () => {
  it("rejects creating a review without authentication", async () => {
    const ownerToken = await registerAndLogin("owner@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });

    const res = await request(app)
      .post(`/api/market/items/${createRes.body.id}/reviews`)
      .send({ rating: 5 });
    expect(res.status).toBe(401);
  });

  it("returns 404 reviewing a non-existent item", async () => {
    const userToken = await registerAndLogin("reviewer1@example.com");
    const res = await request(app)
      .post("/api/market/items/00000000-0000-0000-0000-000000000000/reviews")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 4 });
    expect(res.status).toBe(404);
  });

  it("rejects an out-of-range or missing rating", async () => {
    const ownerToken = await registerAndLogin("owner2@example.com");
    const userToken = await registerAndLogin("reviewer2@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;

    const tooHigh = await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 6 });
    expect(tooHigh.status).toBe(400);

    const missing = await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({});
    expect(missing.status).toBe(400);
  });

  it("creates a review and rejects a second one from the same user", async () => {
    const ownerToken = await registerAndLogin("owner3@example.com");
    const userToken = await registerAndLogin("reviewer3@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;

    const reviewRes = await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 4, comment: "Pretty good" });
    expect(reviewRes.status).toBe(201);
    expect(reviewRes.body.rating).toBe(4);
    expect(reviewRes.body.comment).toBe("Pretty good");

    const dupRes = await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 3 });
    expect(dupRes.status).toBe(409);
  });

  it("updates a review only by its owner", async () => {
    const ownerToken = await registerAndLogin("owner4@example.com");
    const userToken = await registerAndLogin("reviewer4@example.com");
    const otherToken = await registerAndLogin("other4@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;

    const reviewRes = await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 3 });
    const reviewId = reviewRes.body.id;

    const forbiddenRes = await request(app)
      .patch(`/api/market/items/${itemId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ rating: 1 });
    expect(forbiddenRes.status).toBe(403);

    const updateRes = await request(app)
      .patch(`/api/market/items/${itemId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 5, comment: "Actually great" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.rating).toBe(5);
    expect(updateRes.body.comment).toBe("Actually great");
  });

  it("deletes a review by its owner or an admin, but not by another user", async () => {
    const ownerToken = await registerAndLogin("owner5@example.com");
    const userToken = await registerAndLogin("reviewer5@example.com");
    const otherToken = await registerAndLogin("other5@example.com");
    const adminToken = await registerAndLogin("admin5@example.com", "ADMIN");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;

    const reviewRes = await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ rating: 2 });
    const reviewId = reviewRes.body.id;

    const forbiddenRes = await request(app)
      .delete(`/api/market/items/${itemId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbiddenRes.status).toBe(403);

    const adminDeleteRes = await request(app)
      .delete(`/api/market/items/${itemId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminDeleteRes.status).toBe(204);

    const notFoundRes = await request(app)
      .delete(`/api/market/items/${itemId}/reviews/${reviewId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(notFoundRes.status).toBe(404);
  });

  it("lists reviews for an item, paginated", async () => {
    const ownerToken = await registerAndLogin("owner6@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;

    for (let i = 0; i < 3; i += 1) {
      const reviewerToken = await registerAndLogin(`bulkreviewer${i}@example.com`);
      await request(app)
        .post(`/api/market/items/${itemId}/reviews`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ rating: i + 1 });
    }

    const listRes = await request(app).get(`/api/market/items/${itemId}/reviews`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(3);
    expect(listRes.body.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });

    const pagedRes = await request(app).get(`/api/market/items/${itemId}/reviews?page=1&limit=2`);
    expect(pagedRes.body.items).toHaveLength(2);
  });

  it("computes averageRating and reviewCount on the item detail and list endpoints", async () => {
    const ownerToken = await registerAndLogin("owner7@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Gadget", price: 100 });
    const itemId = createRes.body.id;
    expect(createRes.body.averageRating).toBeNull();
    expect(createRes.body.reviewCount).toBe(0);

    const reviewer1Token = await registerAndLogin("avgreviewer1@example.com");
    const reviewer2Token = await registerAndLogin("avgreviewer2@example.com");
    await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${reviewer1Token}`)
      .send({ rating: 5 });
    await request(app)
      .post(`/api/market/items/${itemId}/reviews`)
      .set("Authorization", `Bearer ${reviewer2Token}`)
      .send({ rating: 2 });

    const detailRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(detailRes.body.averageRating).toBe(3.5);
    expect(detailRes.body.reviewCount).toBe(2);

    const listRes = await request(app).get("/api/market/items");
    expect(listRes.body.items[0].averageRating).toBe(3.5);
    expect(listRes.body.items[0].reviewCount).toBe(2);
  });
});
