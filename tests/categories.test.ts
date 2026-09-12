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
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Categories API", () => {
  it("lists categories publicly with no authentication", async () => {
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it("rejects creating a category without authentication", async () => {
    const res = await request(app).post("/api/categories").send({ name: "Electronics" });
    expect(res.status).toBe(401);
  });

  it("rejects creating a category as a non-admin", async () => {
    const userToken = await registerAndLogin("catuser1@example.com", "USER");
    const res = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Electronics" });
    expect(res.status).toBe(403);
  });

  it("creates a category as admin and rejects a duplicate name", async () => {
    const adminToken = await registerAndLogin("catadmin1@example.com", "ADMIN");

    const createRes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Electronics" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe("Electronics");

    const dupRes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Electronics" });
    expect(dupRes.status).toBe(409);
  });

  it("rejects an empty category name", async () => {
    const adminToken = await registerAndLogin("catadmin2@example.com", "ADMIN");
    const res = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("updates a category as admin, 404s for a missing one, 403s for a non-admin", async () => {
    const adminToken = await registerAndLogin("catadmin3@example.com", "ADMIN");
    const userToken = await registerAndLogin("catuser3@example.com", "USER");

    const createRes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Books" });
    const categoryId = createRes.body.id;

    const forbiddenRes = await request(app)
      .patch(`/api/categories/${categoryId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Textbooks" });
    expect(forbiddenRes.status).toBe(403);

    const updateRes = await request(app)
      .patch(`/api/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Textbooks" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe("Textbooks");

    const notFoundRes = await request(app)
      .patch("/api/categories/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Whatever" });
    expect(notFoundRes.status).toBe(404);
  });

  it("deletes a category as admin and un-sets it from items (does not delete the item)", async () => {
    const adminToken = await registerAndLogin("catadmin4@example.com", "ADMIN");
    const createCatRes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Toys" });
    const categoryId = createCatRes.body.id;

    const createItemRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Toy Car", price: 15, categoryId });
    const itemId = createItemRes.body.id;
    expect(createItemRes.body.category.id).toBe(categoryId);

    const deleteRes = await request(app)
      .delete(`/api/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);

    const itemRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemRes.status).toBe(200);
    expect(itemRes.body.category).toBeNull();

    const secondDeleteRes = await request(app)
      .delete(`/api/categories/${categoryId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(secondDeleteRes.status).toBe(404);
  });
});

describe("Market items with categories", () => {
  it("creates an item without a category (category is null)", async () => {
    const userToken = await registerAndLogin("itemuser1@example.com", "USER");
    const res = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Widget", price: 10 });
    expect(res.status).toBe(201);
    expect(res.body.category).toBeNull();
  });

  it("rejects creating an item with a non-existent categoryId", async () => {
    const userToken = await registerAndLogin("itemuser2@example.com", "USER");
    const res = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Widget", price: 10, categoryId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("sets and clears an item's category via update", async () => {
    const userToken = await registerAndLogin("itemuser3@example.com", "USER");
    const adminToken = await registerAndLogin("itemadmin3@example.com", "ADMIN");
    const catRes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Garden" });
    const categoryId = catRes.body.id;

    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "Rake", price: 20 });
    const itemId = createRes.body.id;

    const setRes = await request(app)
      .patch(`/api/market/items/${itemId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ categoryId });
    expect(setRes.status).toBe(200);
    expect(setRes.body.category.name).toBe("Garden");

    const clearRes = await request(app)
      .patch(`/api/market/items/${itemId}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ categoryId: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.category).toBeNull();
  });

  it("filters the item list by categoryId", async () => {
    const userToken = await registerAndLogin("itemuser4@example.com", "USER");
    const adminToken = await registerAndLogin("itemadmin4@example.com", "ADMIN");
    const catARes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Category A" });
    const catBRes = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Category B" });

    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "In A", price: 1, categoryId: catARes.body.id });
    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "In B", price: 1, categoryId: catBRes.body.id });
    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "No category", price: 1 });

    const res = await request(app).get(`/api/market/items?categoryId=${catARes.body.id}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe("In A");
  });
});
