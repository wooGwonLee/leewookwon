import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

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
});
