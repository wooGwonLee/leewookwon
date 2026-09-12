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

async function order(
  token: string,
  marketItemId: string,
  quantity: number,
): Promise<{ id: string }> {
  const res = await request(app)
    .post("/api/orders")
    .set("Authorization", `Bearer ${token}`)
    .send({ items: [{ marketItemId, quantity }] });
  return res.body;
}

beforeEach(async () => {
  await prisma.order.deleteMany();
  await prisma.marketItem.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Admin stats access control", () => {
  it("rejects unauthenticated requests on all three endpoints", async () => {
    const summaryRes = await request(app).get("/api/admin/stats/summary");
    expect(summaryRes.status).toBe(401);
    const topRes = await request(app).get("/api/admin/stats/top-items");
    expect(topRes.status).toBe(401);
    const lowStockRes = await request(app).get("/api/admin/stats/low-stock");
    expect(lowStockRes.status).toBe(401);
  });

  it("rejects a non-admin on all three endpoints", async () => {
    const token = await registerAndLogin("statsuser1@example.com");
    const summaryRes = await request(app)
      .get("/api/admin/stats/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(summaryRes.status).toBe(403);
    const topRes = await request(app)
      .get("/api/admin/stats/top-items")
      .set("Authorization", `Bearer ${token}`);
    expect(topRes.status).toBe(403);
    const lowStockRes = await request(app)
      .get("/api/admin/stats/low-stock")
      .set("Authorization", `Bearer ${token}`);
    expect(lowStockRes.status).toBe(403);
  });
});

describe("GET /api/admin/stats/summary", () => {
  it("reports counts, order status breakdown, revenue, and low-stock count", async () => {
    const userToken = await registerAndLogin("statsuser2@example.com");
    const adminToken = await registerAndLogin("statsadmin1@example.com", "ADMIN");

    const itemAId = await createItem(userToken, { name: "A", price: 10, stock: 100 });
    const itemBId = await createItem(userToken, { name: "B", price: 20, stock: 2 });

    await order(userToken, itemAId, 3); // PENDING, totalPrice 30
    const orderB = await order(userToken, itemBId, 1); // will be completed, totalPrice 20
    const orderC = await order(userToken, itemAId, 1); // will be cancelled

    await request(app)
      .patch(`/api/orders/${orderB.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONFIRMED" });
    await request(app)
      .patch(`/api/orders/${orderB.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "COMPLETED" });

    await request(app)
      .patch(`/api/orders/${orderC.id}/cancel`)
      .set("Authorization", `Bearer ${userToken}`);
    // orderA stays PENDING

    const res = await request(app)
      .get("/api/admin/stats/summary")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(2);
    expect(res.body.totalItems).toBe(2);
    expect(res.body.totalOrders).toBe(3);
    expect(res.body.ordersByStatus).toEqual({
      PENDING: 1,
      CONFIRMED: 0,
      COMPLETED: 1,
      CANCELLED: 1,
    });
    expect(res.body.totalRevenue).toBe(20);
    expect(res.body.lowStockThreshold).toBe(5);
    expect(res.body.lowStockItemCount).toBe(1);
  });

  it("accepts a custom lowStockThreshold and rejects an invalid one", async () => {
    const userToken = await registerAndLogin("statsuser3@example.com");
    const adminToken = await registerAndLogin("statsadmin2@example.com", "ADMIN");
    await createItem(userToken, { name: "A", stock: 8 });

    const res = await request(app)
      .get("/api/admin/stats/summary?lowStockThreshold=10")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.lowStockThreshold).toBe(10);
    expect(res.body.lowStockItemCount).toBe(1);

    const badRes = await request(app)
      .get("/api/admin/stats/summary?lowStockThreshold=-1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badRes.status).toBe(400);
  });
});

describe("GET /api/admin/stats/top-items", () => {
  it("ranks items by total quantity sold, excluding cancelled orders", async () => {
    const userToken = await registerAndLogin("statsuser4@example.com");
    const adminToken = await registerAndLogin("statsadmin3@example.com", "ADMIN");
    const itemAId = await createItem(userToken, { name: "A", price: 10, stock: 100 });
    const itemBId = await createItem(userToken, { name: "B", price: 5, stock: 100 });

    await order(userToken, itemAId, 2);
    await order(userToken, itemBId, 5);
    const cancelledOrder = await order(userToken, itemBId, 100);
    await request(app)
      .patch(`/api/orders/${cancelledOrder.id}/cancel`)
      .set("Authorization", `Bearer ${userToken}`);

    const res = await request(app)
      .get("/api/admin/stats/top-items")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].marketItemId).toBe(itemBId);
    expect(res.body[0].totalQuantitySold).toBe(5);
    expect(res.body[0].totalRevenue).toBe(25);
    expect(res.body[1].marketItemId).toBe(itemAId);
    expect(res.body[1].totalQuantitySold).toBe(2);
    expect(res.body[1].totalRevenue).toBe(20);
  });

  it("respects a custom limit and rejects an invalid one", async () => {
    const userToken = await registerAndLogin("statsuser5@example.com");
    const adminToken = await registerAndLogin("statsadmin4@example.com", "ADMIN");
    const itemAId = await createItem(userToken, { name: "A", stock: 100 });
    const itemBId = await createItem(userToken, { name: "B", stock: 100 });
    await order(userToken, itemAId, 1);
    await order(userToken, itemBId, 1);

    const res = await request(app)
      .get("/api/admin/stats/top-items?limit=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const badRes = await request(app)
      .get("/api/admin/stats/top-items?limit=0")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badRes.status).toBe(400);
  });
});

describe("GET /api/admin/stats/low-stock", () => {
  it("lists items at or below the threshold, sorted by stock ascending, paginated", async () => {
    const userToken = await registerAndLogin("statsuser6@example.com");
    const adminToken = await registerAndLogin("statsadmin5@example.com", "ADMIN");
    await createItem(userToken, { name: "Plenty", stock: 50 });
    await createItem(userToken, { name: "Low", stock: 3 });
    await createItem(userToken, { name: "Out", stock: 0 });

    const res = await request(app)
      .get("/api/admin/stats/low-stock")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(["Out", "Low"]);
    expect(res.body.pagination.total).toBe(2);
  });

  it("respects a custom threshold", async () => {
    const userToken = await registerAndLogin("statsuser7@example.com");
    const adminToken = await registerAndLogin("statsadmin6@example.com", "ADMIN");
    await createItem(userToken, { name: "Mid", stock: 8 });

    const res = await request(app)
      .get("/api/admin/stats/low-stock?threshold=10")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.items).toHaveLength(1);

    const strictRes = await request(app)
      .get("/api/admin/stats/low-stock?threshold=3")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(strictRes.body.items).toHaveLength(0);
  });
});
