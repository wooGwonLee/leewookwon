import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";

const app = createApp();

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Auth API", () => {
  it("registers a new user", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "new@example.com", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new@example.com");
    expect(res.body.role).toBe("USER");
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("rejects registering the same email twice", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@example.com", password: "password123" });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "dup@example.com", password: "password123" });
    expect(res.status).toBe(409);
  });

  it("rejects a short password on register", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "short@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and returns a token", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "login@example.com", password: "password123" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user.email).toBe("login@example.com");
  });

  it("rejects login with wrong password", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "wrongpw@example.com", password: "password123" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "wrongpw@example.com", password: "nope12345" });
    expect(res.status).toBe(401);
  });

  it("rejects login for a non-existent user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });
    expect(res.status).toBe(401);
  });
});
