import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";

const app = createApp();

beforeEach(async () => {
  await prisma.marketItem.deleteMany();
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

  it("creates, fetches, updates, and deletes an item", async () => {
    const createRes = await request(app)
      .post("/api/market/items")
      .send({ name: "Sample Product", price: 1000 });
    expect(createRes.status).toBe(201);
    const { id } = createRes.body;
    expect(id).toBeDefined();

    const getRes = await request(app).get(`/api/market/items/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe("Sample Product");

    const updateRes = await request(app)
      .patch(`/api/market/items/${id}`)
      .send({ price: 2000 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.price).toBe(2000);

    const deleteRes = await request(app).delete(`/api/market/items/${id}`);
    expect(deleteRes.status).toBe(204);

    const getAfterDeleteRes = await request(app).get(`/api/market/items/${id}`);
    expect(getAfterDeleteRes.status).toBe(404);
  });

  it("rejects invalid input on create", async () => {
    const res = await request(app).post("/api/market/items").send({ name: "No price" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when updating or deleting a non-existent item", async () => {
    const updateRes = await request(app)
      .patch("/api/market/items/00000000-0000-0000-0000-000000000000")
      .send({ price: 1 });
    expect(updateRes.status).toBe(404);

    const deleteRes = await request(app).delete(
      "/api/market/items/00000000-0000-0000-0000-000000000000",
    );
    expect(deleteRes.status).toBe(404);
  });
});
