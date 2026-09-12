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

async function createItem(
  token: string,
  overrides: Partial<{ name: string; price: number; stock: number }> = {},
): Promise<string> {
  const res = await request(app)
    .post("/api/market/items")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Widget", price: 10, ...overrides });
  return res.body.id;
}

beforeEach(async () => {
  await prisma.order.deleteMany();
  await prisma.marketItem.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Option management", () => {
  it("rejects creating an option without authentication", async () => {
    const token = await registerAndLogin("optionuser1@example.com");
    const itemId = await createItem(token);
    const res = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .send({ name: "L / Red" });
    expect(res.status).toBe(401);
  });

  it("creates an option with defaults applied", async () => {
    const token = await registerAndLogin("optionuser2@example.com");
    const itemId = await createItem(token);
    const res = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "L / Red" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("L / Red");
    expect(res.body.priceDelta).toBe(0);
    expect(res.body.stock).toBe(0);
  });

  it("creates an option with explicit priceDelta and stock", async () => {
    const token = await registerAndLogin("optionuser3@example.com");
    const itemId = await createItem(token);
    const res = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "XL / Blue", priceDelta: 5, stock: 20 });
    expect(res.status).toBe(201);
    expect(res.body.priceDelta).toBe(5);
    expect(res.body.stock).toBe(20);
  });

  it("rejects an empty name, non-number priceDelta, or invalid stock", async () => {
    const token = await registerAndLogin("optionuser4@example.com");
    const itemId = await createItem(token);

    const emptyName = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "  " });
    expect(emptyName.status).toBe(400);

    const badPriceDelta = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M / Green", priceDelta: "five" });
    expect(badPriceDelta.status).toBe(400);

    const badStock = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M / Green", stock: -1 });
    expect(badStock.status).toBe(400);
  });

  it("returns 404 creating an option for a non-existent item", async () => {
    const token = await registerAndLogin("optionuser5@example.com");
    const res = await request(app)
      .post("/api/market/items/00000000-0000-0000-0000-000000000000/options")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "L / Red" });
    expect(res.status).toBe(404);
  });

  it("rejects a duplicate option name for the same item", async () => {
    const token = await registerAndLogin("optionuser6@example.com");
    const itemId = await createItem(token);
    await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "L / Red" });
    const dupRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "L / Red" });
    expect(dupRes.status).toBe(409);
  });

  it("includes options in the item response", async () => {
    const token = await registerAndLogin("optionuser7@example.com");
    const itemId = await createItem(token);
    await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "L / Red", stock: 5 });

    const res = await request(app).get(`/api/market/items/${itemId}`);
    expect(res.body.options).toHaveLength(1);
    expect(res.body.options[0].name).toBe("L / Red");
  });

  it("updates an option, rejecting a name collision, and 404s for a missing/foreign option", async () => {
    const token = await registerAndLogin("optionuser8@example.com");
    const itemId = await createItem(token);
    const otherItemId = await createItem(token, { name: "Other" });

    const optARes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red" });
    const optBRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M / Red" });

    const updateRes = await request(app)
      .patch(`/api/market/items/${itemId}/options/${optARes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stock: 15 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.stock).toBe(15);

    const collisionRes = await request(app)
      .patch(`/api/market/items/${itemId}/options/${optARes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: optBRes.body.name });
    expect(collisionRes.status).toBe(409);

    const missingRes = await request(app)
      .patch(`/api/market/items/${itemId}/options/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stock: 1 });
    expect(missingRes.status).toBe(404);

    const foreignOptRes = await request(app)
      .post(`/api/market/items/${otherItemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red" });
    const crossItemRes = await request(app)
      .patch(`/api/market/items/${itemId}/options/${foreignOptRes.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stock: 1 });
    expect(crossItemRes.status).toBe(404);
  });

  it("deletes an option that has never been ordered", async () => {
    const token = await registerAndLogin("optionuser9@example.com");
    const itemId = await createItem(token);
    const optRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "L / Red" });

    const deleteRes = await request(app)
      .delete(`/api/market/items/${itemId}/options/${optRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(204);

    const secondDeleteRes = await request(app)
      .delete(`/api/market/items/${itemId}/options/${optRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(secondDeleteRes.status).toBe(404);
  });
});

describe("Ordering with options", () => {
  it("orders a specific option, decrementing its stock (not the item's) and snapshotting item price + priceDelta", async () => {
    const token = await registerAndLogin("orderoptuser1@example.com");
    const itemId = await createItem(token, { price: 10, stock: 100 });
    const optRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "XL / Blue", priceDelta: 5, stock: 3 });
    const optionId = optRes.body.id;

    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, marketItemOptionId: optionId, quantity: 2 }] });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.totalPrice).toBe(30);
    const orderItem = orderRes.body.items[0];
    expect(orderItem.priceAtOrder).toBe(15);
    expect(orderItem.marketItemOption.name).toBe("XL / Blue");

    const itemAfter = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemAfter.body.stock).toBe(100);
    expect(itemAfter.body.options[0].stock).toBe(1);
  });

  it("allows ordering the same item with two different options in one request", async () => {
    const token = await registerAndLogin("orderoptuser2@example.com");
    const itemId = await createItem(token, { stock: 100 });
    const optARes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red", stock: 5 });
    const optBRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M / Red", stock: 5 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { marketItemId: itemId, marketItemOptionId: optARes.body.id, quantity: 1 },
          { marketItemId: itemId, marketItemOptionId: optBRes.body.id, quantity: 1 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
  });

  it("rejects duplicate marketItemId+marketItemOptionId entries in one order", async () => {
    const token = await registerAndLogin("orderoptuser3@example.com");
    const itemId = await createItem(token, { stock: 100 });
    const optRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red", stock: 5 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { marketItemId: itemId, marketItemOptionId: optRes.body.id, quantity: 1 },
          { marketItemId: itemId, marketItemOptionId: optRes.body.id, quantity: 1 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("returns 404 ordering an option that doesn't belong to the given item", async () => {
    const token = await registerAndLogin("orderoptuser4@example.com");
    const itemAId = await createItem(token, { name: "A", stock: 10 });
    const itemBId = await createItem(token, { name: "B", stock: 10 });
    const optRes = await request(app)
      .post(`/api/market/items/${itemBId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red", stock: 5 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemAId, marketItemOptionId: optRes.body.id, quantity: 1 }] });
    expect(res.status).toBe(404);
  });

  it("returns 409 and changes nothing when option stock is insufficient", async () => {
    const token = await registerAndLogin("orderoptuser5@example.com");
    const itemId = await createItem(token, { stock: 100 });
    const optRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red", stock: 1 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, marketItemOptionId: optRes.body.id, quantity: 5 }] });
    expect(res.status).toBe(409);

    const itemAfter = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemAfter.body.options[0].stock).toBe(1);
    expect(itemAfter.body.stock).toBe(100);
  });

  it("restores option stock when a pending option order is cancelled", async () => {
    const token = await registerAndLogin("orderoptuser6@example.com");
    const itemId = await createItem(token, { stock: 100 });
    const optRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "S / Red", stock: 5 });

    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, marketItemOptionId: optRes.body.id, quantity: 3 }] });

    const cancelRes = await request(app)
      .patch(`/api/orders/${orderRes.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelRes.status).toBe(200);

    const itemAfter = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemAfter.body.options[0].stock).toBe(5);
  });

  it("rejects deleting an option that has an existing order (409)", async () => {
    const userToken = await registerAndLogin("orderoptuser7@example.com");
    const itemId = await createItem(userToken, { stock: 100 });
    const optRes = await request(app)
      .post(`/api/market/items/${itemId}/options`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ name: "S / Red", stock: 5 });

    await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, marketItemOptionId: optRes.body.id, quantity: 1 }] });

    const deleteRes = await request(app)
      .delete(`/api/market/items/${itemId}/options/${optRes.body.id}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(deleteRes.status).toBe(409);
  });
});
