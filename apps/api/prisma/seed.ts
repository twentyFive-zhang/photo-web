import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

process.env.DATABASE_URL ??=
  "postgresql://photo:photo@localhost:5432/photo?schema=public";

const prisma = new PrismaClient();

const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD;

if (!password) {
  throw new Error(
    "ADMIN_PASSWORD is required to seed the break-glass admin account",
  );
}

// break-glass 应急账号（DESIGN.md §1 P2）：这是唯一的密码建号路径，且只保证这一个账号。
// 该账号 sub 保持为空 = 本地应急账号，仅当统一身份源不可用时经 /admin/login/glass 登录。
// 日常账号一律走统一登录（OIDC 首登自动建号，sub 非空），不在 seed 里创建。
try {
  const passwordHash = await argon2.hash(password);

  await prisma.admin.upsert({
    where: { username },
    update: { passwordHash, sub: null },
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

  console.log(`Seeded break-glass admin "${username}" and site settings.`);
} finally {
  await prisma.$disconnect();
}
