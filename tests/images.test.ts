import fs from "fs";
import path from "path";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";
import { ensureUploadDirs, MARKET_ITEM_IMAGES_DIR } from "../src/upload";

const app = createApp();

// A minimal valid 1x1 transparent PNG.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function registerAndLogin(email: string): Promise<string> {
  await request(app).post("/api/auth/register").send({ email, password: "password123" });
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "password123" });
  return loginRes.body.token;
}

async function createItem(token: string): Promise<string> {
  const res = await request(app)
    .post("/api/market/items")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Photographed Item", price: 10 });
  return res.body.id;
}

beforeEach(async () => {
  await prisma.marketItemImage.deleteMany();
  await prisma.review.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.marketItem.deleteMany();
  await prisma.user.deleteMany();
  fs.rmSync(MARKET_ITEM_IMAGES_DIR, { recursive: true, force: true });
  ensureUploadDirs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Market item images API", () => {
  it("rejects uploading without authentication", async () => {
    const token = await registerAndLogin("imgowner1@example.com");
    const itemId = await createItem(token);

    const res = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .attach("images", PNG_BUFFER, { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("returns 404 uploading to a non-existent item", async () => {
    const token = await registerAndLogin("imgowner2@example.com");
    const res = await request(app)
      .post("/api/market/items/00000000-0000-0000-0000-000000000000/images")
      .set("Authorization", `Bearer ${token}`)
      .attach("images", PNG_BUFFER, { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(404);
  });

  it("rejects a non-image file", async () => {
    const token = await registerAndLogin("imgowner3@example.com");
    const itemId = await createItem(token);

    const res = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .set("Authorization", `Bearer ${token}`)
      .attach("images", Buffer.from("not an image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("rejects an upload with no files", async () => {
    const token = await registerAndLogin("imgowner4@example.com");
    const itemId = await createItem(token);

    const res = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("uploads one image and it appears on the item, and is servable", async () => {
    const token = await registerAndLogin("imgowner5@example.com");
    const itemId = await createItem(token);

    const uploadRes = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .set("Authorization", `Bearer ${token}`)
      .attach("images", PNG_BUFFER, { filename: "photo.png", contentType: "image/png" });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.images).toHaveLength(1);
    const imageUrl = uploadRes.body.images[0].url;
    expect(imageUrl).toMatch(/^\/uploads\/market-items\/.+\.png$/);

    const detailRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(detailRes.body.images).toHaveLength(1);
    expect(detailRes.body.images[0].url).toBe(imageUrl);

    const fileRes = await request(app).get(imageUrl);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers["content-type"]).toContain("image/png");
  });

  it("uploads multiple images in one request", async () => {
    const token = await registerAndLogin("imgowner6@example.com");
    const itemId = await createItem(token);

    const res = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .set("Authorization", `Bearer ${token}`)
      .attach("images", PNG_BUFFER, { filename: "a.png", contentType: "image/png" })
      .attach("images", PNG_BUFFER, { filename: "b.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.images).toHaveLength(2);

    const detailRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(detailRes.body.images).toHaveLength(2);
  });

  it("removes an image, and a second removal 404s", async () => {
    const token = await registerAndLogin("imgowner7@example.com");
    const itemId = await createItem(token);

    const uploadRes = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .set("Authorization", `Bearer ${token}`)
      .attach("images", PNG_BUFFER, { filename: "photo.png", contentType: "image/png" });
    const imageId = uploadRes.body.images[0].id;
    const filename = uploadRes.body.images[0].url.split("/").pop() as string;
    const filePath = path.join(MARKET_ITEM_IMAGES_DIR, filename);
    expect(fs.existsSync(filePath)).toBe(true);

    const removeRes = await request(app)
      .delete(`/api/market/items/${itemId}/images/${imageId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removeRes.status).toBe(204);
    expect(fs.existsSync(filePath)).toBe(false);

    const secondRemoveRes = await request(app)
      .delete(`/api/market/items/${itemId}/images/${imageId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(secondRemoveRes.status).toBe(404);

    const detailRes = await request(app).get(`/api/market/items/${itemId}`);
    expect(detailRes.body.images).toHaveLength(0);
  });

  it("cleans up image files from disk when the item itself is deleted", async () => {
    const userToken = await registerAndLogin("imgowner8@example.com");
    await request(app)
      .post("/api/auth/register")
      .send({ email: "imgadmin8@example.com", password: "password123" });
    await prisma.user.update({
      where: { email: "imgadmin8@example.com" },
      data: { role: "ADMIN" },
    });
    const adminLoginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "imgadmin8@example.com", password: "password123" });
    const adminToken = adminLoginRes.body.token;
    const itemId = await createItem(userToken);

    const uploadRes = await request(app)
      .post(`/api/market/items/${itemId}/images`)
      .set("Authorization", `Bearer ${userToken}`)
      .attach("images", PNG_BUFFER, { filename: "photo.png", contentType: "image/png" });
    const filename = uploadRes.body.images[0].url.split("/").pop() as string;
    const filePath = path.join(MARKET_ITEM_IMAGES_DIR, filename);
    expect(fs.existsSync(filePath)).toBe(true);

    const deleteRes = await request(app)
      .delete(`/api/market/items/${itemId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
