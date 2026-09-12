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
    .send({ name: "Widget", price: 10, stock: 10, ...overrides });
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

describe("Order creation", () => {
  it("rejects creating an order without authentication", async () => {
    const res = await request(app).post("/api/orders").send({ items: [] });
    expect(res.status).toBe(401);
  });

  it("rejects an empty or malformed items array", async () => {
    const token = await registerAndLogin("orderuser1@example.com");
    const empty = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [] });
    expect(empty.status).toBe(400);

    const badQuantity = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: "x", quantity: 0 }] });
    expect(badQuantity.status).toBe(400);

    const fractionalQuantity = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: "x", quantity: 1.5 }] });
    expect(fractionalQuantity.status).toBe(400);
  });

  it("rejects duplicate marketItemId entries in a single order", async () => {
    const token = await registerAndLogin("orderuser2@example.com");
    const itemId = await createItem(token);
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { marketItemId: itemId, quantity: 1 },
          { marketItemId: itemId, quantity: 2 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("returns 404 when an item in the order doesn't exist", async () => {
    const token = await registerAndLogin("orderuser3@example.com");
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: "00000000-0000-0000-0000-000000000000", quantity: 1 }] });
    expect(res.status).toBe(404);
  });

  it("creates an order, decrements stock, and snapshots the price/total", async () => {
    const token = await registerAndLogin("orderuser4@example.com");
    const itemAId = await createItem(token, { name: "A", price: 10, stock: 5 });
    const itemBId = await createItem(token, { name: "B", price: 20, stock: 5 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { marketItemId: itemAId, quantity: 2 },
          { marketItemId: itemBId, quantity: 1 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.totalPrice).toBe(40);
    expect(res.body.items).toHaveLength(2);
    const itemA = res.body.items.find((i: { marketItemId: string }) => i.marketItemId === itemAId);
    expect(itemA.quantity).toBe(2);
    expect(itemA.priceAtOrder).toBe(10);
    expect(itemA.marketItem.name).toBe("A");

    const itemAAfter = await request(app).get(`/api/market/items/${itemAId}`);
    expect(itemAAfter.body.stock).toBe(3);
    const itemBAfter = await request(app).get(`/api/market/items/${itemBId}`);
    expect(itemBAfter.body.stock).toBe(4);
  });

  it("returns 409 and changes nothing when stock is insufficient", async () => {
    const token = await registerAndLogin("orderuser5@example.com");
    const itemId = await createItem(token, { stock: 1 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, quantity: 5 }] });
    expect(res.status).toBe(409);

    const itemAfter = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemAfter.body.stock).toBe(1);
    expect(await prisma.order.count()).toBe(0);
  });

  it("rolls back the whole order (including stock) if any single item fails", async () => {
    const token = await registerAndLogin("orderuser6@example.com");
    const okItemId = await createItem(token, { name: "OK", stock: 5 });
    const shortItemId = await createItem(token, { name: "Short", stock: 1 });

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          { marketItemId: okItemId, quantity: 2 },
          { marketItemId: shortItemId, quantity: 5 },
        ],
      });
    expect(res.status).toBe(409);

    const okItemAfter = await request(app).get(`/api/market/items/${okItemId}`);
    expect(okItemAfter.body.stock).toBe(5);
    expect(await prisma.order.count()).toBe(0);
  });
});

describe("Order listing and retrieval", () => {
  it("lists only the current user's own orders", async () => {
    const tokenA = await registerAndLogin("orderuserA@example.com");
    const tokenB = await registerAndLogin("orderuserB@example.com");
    const itemId = await createItem(tokenA);

    await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });

    const listA = await request(app).get("/api/orders").set("Authorization", `Bearer ${tokenA}`);
    expect(listA.body.items).toHaveLength(1);

    const listB = await request(app).get("/api/orders").set("Authorization", `Bearer ${tokenB}`);
    expect(listB.body.items).toHaveLength(0);
  });

  it("lists all users' orders for an admin", async () => {
    const userToken = await registerAndLogin("orderuser7@example.com");
    const adminToken = await registerAndLogin("orderadmin1@example.com", "ADMIN");
    const itemId = await createItem(userToken);

    await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });

    const listAdmin = await request(app)
      .get("/api/orders")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(listAdmin.body.items).toHaveLength(1);
  });

  it("gets a single order for its owner or an admin, 403 for another user, 404 when missing", async () => {
    const ownerToken = await registerAndLogin("orderowner1@example.com");
    const otherToken = await registerAndLogin("orderother1@example.com");
    const adminToken = await registerAndLogin("orderadmin2@example.com", "ADMIN");
    const itemId = await createItem(ownerToken);

    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });
    const orderId = createRes.body.id;

    const ownerRes = await request(app)
      .get(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerRes.status).toBe(200);

    const otherRes = await request(app)
      .get(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(otherRes.status).toBe(403);

    const adminRes = await request(app)
      .get(`/api/orders/${orderId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);

    const missingRes = await request(app)
      .get("/api/orders/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(missingRes.status).toBe(404);
  });
});

describe("Order cancellation", () => {
  it("lets the owner cancel a pending order and restores stock", async () => {
    const token = await registerAndLogin("ordercancel1@example.com");
    const itemId = await createItem(token, { stock: 5 });
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, quantity: 3 }] });
    const orderId = createRes.body.id;

    const cancelRes = await request(app)
      .patch(`/api/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("CANCELLED");

    const itemAfter = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemAfter.body.stock).toBe(5);
  });

  it("rejects cancelling another user's order (403) and a non-pending order (409)", async () => {
    const ownerToken = await registerAndLogin("ordercancel2@example.com");
    const otherToken = await registerAndLogin("ordercancel3@example.com");
    const adminToken = await registerAndLogin("orderadmin3@example.com", "ADMIN");
    const itemId = await createItem(ownerToken);

    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });
    const orderId = createRes.body.id;

    const forbiddenRes = await request(app)
      .patch(`/api/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbiddenRes.status).toBe(403);

    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });

    const conflictRes = await request(app)
      .patch(`/api/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(conflictRes.status).toBe(409);
  });

  it("returns 404 cancelling a non-existent order", async () => {
    const token = await registerAndLogin("ordercancel4@example.com");
    const res = await request(app)
      .patch("/api/orders/00000000-0000-0000-0000-000000000000/cancel")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("Admin order status management", () => {
  it("rejects a non-admin setting order status", async () => {
    const token = await registerAndLogin("orderstatususer1@example.com");
    const itemId = await createItem(token);
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });

    const res = await request(app)
      .patch(`/api/orders/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "CONFIRMED" });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid status value", async () => {
    const userToken = await registerAndLogin("orderstatususer2@example.com");
    const adminToken = await registerAndLogin("orderadmin4@example.com", "ADMIN");
    const itemId = await createItem(userToken);
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });

    const res = await request(app)
      .patch(`/api/orders/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "NOT_A_STATUS" });
    expect(res.status).toBe(400);
  });

  it("walks an order through PENDING -> CONFIRMED -> COMPLETED", async () => {
    const userToken = await registerAndLogin("orderstatususer3@example.com");
    const adminToken = await registerAndLogin("orderadmin5@example.com", "ADMIN");
    const itemId = await createItem(userToken);
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });
    const orderId = createRes.body.id;

    const confirmRes = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("CONFIRMED");

    const completeRes = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "COMPLETED" });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("COMPLETED");
  });

  it("rejects skipping states or moving a terminal order (409)", async () => {
    const userToken = await registerAndLogin("orderstatususer4@example.com");
    const adminToken = await registerAndLogin("orderadmin6@example.com", "ADMIN");
    const itemId = await createItem(userToken);
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });
    const orderId = createRes.body.id;

    const skipRes = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "COMPLETED" });
    expect(skipRes.status).toBe(409);

    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED" });

    const terminalRes = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    expect(terminalRes.status).toBe(409);
  });

  it("returns 404 setting status on a non-existent order", async () => {
    const adminToken = await registerAndLogin("orderadmin7@example.com", "ADMIN");
    const res = await request(app)
      .patch("/api/orders/00000000-0000-0000-0000-000000000000/status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    expect(res.status).toBe(404);
  });

  it("restores stock when an admin cancels an order via the status endpoint", async () => {
    const userToken = await registerAndLogin("orderstatususer5@example.com");
    const adminToken = await registerAndLogin("orderadmin8@example.com", "ADMIN");
    const itemId = await createItem(userToken, { stock: 5 });
    const createRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 3 }] });

    const cancelRes = await request(app)
      .patch(`/api/orders/${createRes.body.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED" });
    expect(cancelRes.status).toBe(200);

    const itemAfter = await request(app).get(`/api/market/items/${itemId}`);
    expect(itemAfter.body.stock).toBe(5);
  });
});

describe("Deleting a market item with order history", () => {
  it("rejects deleting an item that has an existing order (409)", async () => {
    const userToken = await registerAndLogin("orderdeluser1@example.com");
    const adminToken = await registerAndLogin("orderdeladmin1@example.com", "ADMIN");
    const itemId = await createItem(userToken);

    await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });

    const res = await request(app)
      .delete(`/api/market/items/${itemId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });
});
