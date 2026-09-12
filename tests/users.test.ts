import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/prisma";

const app = createApp();

async function registerAndLogin(
  email: string,
  role: "USER" | "ADMIN" = "USER",
): Promise<{ token: string; id: string }> {
  const registerRes = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "password123" });
  if (role === "ADMIN") {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
  }
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "password123" });
  return { token: loginRes.body.token, id: registerRes.body.id };
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Admin user management API", () => {
  it("rejects listing users without authentication", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });

  it("rejects listing users as a non-admin", async () => {
    const { token } = await registerAndLogin("plainuser@example.com");
    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("lists users as an admin, without exposing passwordHash", async () => {
    const admin = await registerAndLogin("admin1@example.com", "ADMIN");
    await registerAndLogin("member@example.com");

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    for (const user of res.body.items) {
      expect(user.passwordHash).toBeUndefined();
    }
  });

  it("rejects promoting a user without authentication", async () => {
    const target = await registerAndLogin("target1@example.com");
    const res = await request(app)
      .patch(`/api/users/${target.id}/role`)
      .send({ role: "ADMIN" });
    expect(res.status).toBe(401);
  });

  it("rejects promoting a user as a non-admin", async () => {
    const requester = await registerAndLogin("requester1@example.com");
    const target = await registerAndLogin("target2@example.com");
    const res = await request(app)
      .patch(`/api/users/${target.id}/role`)
      .set("Authorization", `Bearer ${requester.token}`)
      .send({ role: "ADMIN" });
    expect(res.status).toBe(403);
  });

  it("promotes a user to ADMIN and can demote back to USER", async () => {
    const admin = await registerAndLogin("admin2@example.com", "ADMIN");
    const target = await registerAndLogin("target3@example.com");

    const promoteRes = await request(app)
      .patch(`/api/users/${target.id}/role`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "ADMIN" });
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.role).toBe("ADMIN");
    expect(promoteRes.body.passwordHash).toBeUndefined();

    const demoteRes = await request(app)
      .patch(`/api/users/${target.id}/role`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "USER" });
    expect(demoteRes.status).toBe(200);
    expect(demoteRes.body.role).toBe("USER");
  });

  it("rejects an invalid role value", async () => {
    const admin = await registerAndLogin("admin3@example.com", "ADMIN");
    const target = await registerAndLogin("target4@example.com");

    const res = await request(app)
      .patch(`/api/users/${target.id}/role`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "SUPERUSER" });
    expect(res.status).toBe(400);
  });

  it("returns 404 promoting a non-existent user", async () => {
    const admin = await registerAndLogin("admin4@example.com", "ADMIN");
    const res = await request(app)
      .patch("/api/users/00000000-0000-0000-0000-000000000000/role")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "ADMIN" });
    expect(res.status).toBe(404);
  });

  it("rejects an admin changing their own role", async () => {
    const admin = await registerAndLogin("admin5@example.com", "ADMIN");
    const res = await request(app)
      .patch(`/api/users/${admin.id}/role`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "USER" });
    expect(res.status).toBe(403);
  });
});
