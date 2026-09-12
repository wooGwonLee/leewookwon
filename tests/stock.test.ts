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
  await prisma.marketItem.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Market item stock", () => {
  it("defaults to 0 when not provided on create", async () => {
    const token = await registerAndLogin("stockowner1@example.com");
    const res = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10 });
    expect(res.status).toBe(201);
    expect(res.body.stock).toBe(0);
  });

  it("accepts an initial stock value on create", async () => {
    const token = await registerAndLogin("stockowner2@example.com");
    const res = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 50 });
    expect(res.status).toBe(201);
    expect(res.body.stock).toBe(50);
  });

  it("rejects a negative or non-integer stock on create", async () => {
    const token = await registerAndLogin("stockowner3@example.com");
    const negative = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: -1 });
    expect(negative.status).toBe(400);

    const fractional = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 1.5 });
    expect(fractional.status).toBe(400);
  });

  it("directly sets stock via PATCH /items/:id", async () => {
    const token = await registerAndLogin("stockowner4@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 10 });
    const itemId = createRes.body.id;

    const updateRes = await request(app)
      .patch(`/api/market/items/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stock: 99 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.stock).toBe(99);

    const negativeRes = await request(app)
      .patch(`/api/market/items/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stock: -5 });
    expect(negativeRes.status).toBe(400);
  });

  it("rejects adjusting stock without authentication", async () => {
    const token = await registerAndLogin("stockowner5@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 10 });
    const itemId = createRes.body.id;

    const res = await request(app).patch(`/api/market/items/${itemId}/stock`).send({ delta: -1 });
    expect(res.status).toBe(401);
  });

  it("increments and decrements stock atomically via delta", async () => {
    const token = await registerAndLogin("stockowner6@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 10 });
    const itemId = createRes.body.id;

    const restockRes = await request(app)
      .patch(`/api/market/items/${itemId}/stock`)
      .set("Authorization", `Bearer ${token}`)
      .send({ delta: 5 });
    expect(restockRes.status).toBe(200);
    expect(restockRes.body.stock).toBe(15);

    const purchaseRes = await request(app)
      .patch(`/api/market/items/${itemId}/stock`)
      .set("Authorization", `Bearer ${token}`)
      .send({ delta: -3 });
    expect(purchaseRes.status).toBe(200);
    expect(purchaseRes.body.stock).toBe(12);
  });

  it("rejects a decrement that would make stock negative (409) without changing it", async () => {
    const token = await registerAndLogin("stockowner7@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 2 });
    const itemId = createRes.body.id;

    const res = await request(app)
      .patch(`/api/market/items/${itemId}/stock`)
      .set("Authorization", `Bearer ${token}`)
      .send({ delta: -3 });
    expect(res.status).toBe(409);

    const getRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(getRes.body.stock).toBe(2);
  });

  it("rejects a zero or non-integer delta", async () => {
    const token = await registerAndLogin("stockowner8@example.com");
    const createRes = await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Widget", price: 10, stock: 10 });
    const itemId = createRes.body.id;

    const zeroRes = await request(app)
      .patch(`/api/market/items/${itemId}/stock`)
      .set("Authorization", `Bearer ${token}`)
      .send({ delta: 0 });
    expect(zeroRes.status).toBe(400);

    const fractionalRes = await request(app)
      .patch(`/api/market/items/${itemId}/stock`)
      .set("Authorization", `Bearer ${token}`)
      .send({ delta: 1.5 });
    expect(fractionalRes.status).toBe(400);
  });

  it("returns 404 adjusting stock on a non-existent item", async () => {
    const token = await registerAndLogin("stockowner9@example.com");
    const res = await request(app)
      .patch("/api/market/items/00000000-0000-0000-0000-000000000000/stock")
      .set("Authorization", `Bearer ${token}`)
      .send({ delta: 1 });
    expect(res.status).toBe(404);
  });

  it("filters the item list by inStock=true", async () => {
    const token = await registerAndLogin("stockowner10@example.com");
    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "In Stock", price: 10, stock: 5 });
    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Out Of Stock", price: 10, stock: 0 });

    const res = await request(app).get("/api/market/items?inStock=true");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe("In Stock");
  });

  it("sorts by stock", async () => {
    const token = await registerAndLogin("stockowner11@example.com");
    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Low", price: 10, stock: 1 });
    await request(app)
      .post("/api/market/items")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "High", price: 10, stock: 100 });

    const res = await request(app).get("/api/market/items?sortBy=stock&sortOrder=desc");
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(["High", "Low"]);
  });
});
