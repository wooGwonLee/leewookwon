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

function addressBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    recipientName: "Jane Doe",
    phone: "010-1234-5678",
    postalCode: "12345",
    address1: "123 Main St",
    ...overrides,
  };
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
  await prisma.address.deleteMany();
  await prisma.marketItem.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Address CRUD", () => {
  it("rejects creating an address without authentication", async () => {
    const res = await request(app).post("/api/addresses").send(addressBody());
    expect(res.status).toBe(401);
  });

  it("creates an address with isDefault defaulting to false", async () => {
    const token = await registerAndLogin("addruser1@example.com");
    const res = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send(addressBody({ label: "Home" }));
    expect(res.status).toBe(201);
    expect(res.body.label).toBe("Home");
    expect(res.body.isDefault).toBe(false);
  });

  it("rejects missing required fields or wrong types", async () => {
    const token = await registerAndLogin("addruser2@example.com");
    const missing = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientName: "Jane" });
    expect(missing.status).toBe(400);

    const badIsDefault = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send(addressBody({ isDefault: "yes" }));
    expect(badIsDefault.status).toBe(400);
  });

  it("lists only the current user's own addresses, default-first then newest-first", async () => {
    const tokenA = await registerAndLogin("addruserA@example.com");
    const tokenB = await registerAndLogin("addruserB@example.com");
    await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(addressBody({ label: "First" }));
    await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(addressBody({ label: "Second (default)", isDefault: true }));
    await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${tokenB}`)
      .send(addressBody({ label: "Not mine" }));

    const res = await request(app)
      .get("/api/addresses")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].label).toBe("Second (default)");
    expect(res.body.items[0].isDefault).toBe(true);
  });

  it("only allows one default address per user at a time", async () => {
    const token = await registerAndLogin("addruser3@example.com");
    const firstRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send(addressBody({ label: "First", isDefault: true }));
    const secondRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send(addressBody({ label: "Second", isDefault: true }));
    expect(secondRes.body.isDefault).toBe(true);

    const firstAfter = await request(app)
      .get(`/api/addresses/${firstRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(firstAfter.body.isDefault).toBe(false);
  });

  it("gets an address for its owner, 403 for another user, 404 when missing", async () => {
    const ownerToken = await registerAndLogin("addrowner1@example.com");
    const otherToken = await registerAndLogin("addrother1@example.com");
    const createRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(addressBody());
    const addressId = createRes.body.id;

    const ownerRes = await request(app)
      .get(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerRes.status).toBe(200);

    const otherRes = await request(app)
      .get(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(otherRes.status).toBe(403);

    const missingRes = await request(app)
      .get("/api/addresses/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(missingRes.status).toBe(404);
  });

  it("updates an address for its owner, 403 for another user, and can clear label with null", async () => {
    const ownerToken = await registerAndLogin("addrowner2@example.com");
    const otherToken = await registerAndLogin("addrother2@example.com");
    const createRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(addressBody({ label: "Home" }));
    const addressId = createRes.body.id;

    const forbiddenRes = await request(app)
      .patch(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ label: "Hacked" });
    expect(forbiddenRes.status).toBe(403);

    const updateRes = await request(app)
      .patch(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ label: null, address1: "456 Other Ave" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.label).toBeNull();
    expect(updateRes.body.address1).toBe("456 Other Ave");
  });

  it("deletes an address for its owner, 403 for another user, 404 when missing", async () => {
    const ownerToken = await registerAndLogin("addrowner3@example.com");
    const otherToken = await registerAndLogin("addrother3@example.com");
    const createRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(addressBody());
    const addressId = createRes.body.id;

    const forbiddenRes = await request(app)
      .delete(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbiddenRes.status).toBe(403);

    const deleteRes = await request(app)
      .delete(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deleteRes.status).toBe(204);

    const secondDeleteRes = await request(app)
      .delete(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(secondDeleteRes.status).toBe(404);
  });
});

describe("Selecting an address at order time", () => {
  it("attaches a shipping snapshot to the order and returns it", async () => {
    const token = await registerAndLogin("addrorderuser1@example.com");
    const itemId = await createItem(token);
    const addressRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send(addressBody({ label: "Home", address2: "Apt 4" }));
    const addressId = addressRes.body.id;

    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }], addressId });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.shippingAddressId).toBe(addressId);
    expect(orderRes.body.shippingSnapshot).toMatchObject({
      label: "Home",
      recipientName: "Jane Doe",
      address2: "Apt 4",
    });
  });

  it("keeps the order's shipping snapshot after the address is later edited or deleted", async () => {
    const token = await registerAndLogin("addrorderuser2@example.com");
    const itemId = await createItem(token);
    const addressRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send(addressBody({ recipientName: "Original Name" }));
    const addressId = addressRes.body.id;

    const orderRes = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }], addressId });

    await request(app)
      .delete(`/api/addresses/${addressId}`)
      .set("Authorization", `Bearer ${token}`);

    const orderAfter = await request(app)
      .get(`/api/orders/${orderRes.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(orderAfter.status).toBe(200);
    expect(orderAfter.body.shippingAddressId).toBeNull();
    expect(orderAfter.body.shippingSnapshot.recipientName).toBe("Original Name");
  });

  it("returns 404 ordering with another user's address", async () => {
    const ownerToken = await registerAndLogin("addrorderowner@example.com");
    const otherToken = await registerAndLogin("addrorderother@example.com");
    const itemId = await createItem(otherToken);
    const addressRes = await request(app)
      .post("/api/addresses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(addressBody());

    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }], addressId: addressRes.body.id });
    expect(res.status).toBe(404);
  });

  it("returns 404 ordering with a non-existent address", async () => {
    const token = await registerAndLogin("addrorderuser3@example.com");
    const itemId = await createItem(token);
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [{ marketItemId: itemId, quantity: 1 }],
        addressId: "00000000-0000-0000-0000-000000000000",
      });
    expect(res.status).toBe(404);
  });

  it("allows creating an order without an addressId, leaving shipping fields null", async () => {
    const token = await registerAndLogin("addrorderuser4@example.com");
    const itemId = await createItem(token);
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [{ marketItemId: itemId, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.shippingAddressId).toBeNull();
    expect(res.body.shippingSnapshot).toBeNull();
  });
});
