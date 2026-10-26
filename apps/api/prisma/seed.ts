import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

process.env.DATABASE_URL ??=
  "postgresql://photo:photo@localhost:5432/photo?schema=public";

const prisma = new PrismaClient();

const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD;

if (!password) {
  throw new Error("ADMIN_PASSWORD is required to seed the admin account");
}

try {
  const passwordHash = await argon2.hash(password);

  await prisma.admin.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash },
  });

  await prisma.siteSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      siteName: "江流儿摄影",
      siteDescription: "个人摄影作品",
    },
  });

  console.log(`Seeded admin "${username}" and site settings.`);
} finally {
  await prisma.$disconnect();
}
