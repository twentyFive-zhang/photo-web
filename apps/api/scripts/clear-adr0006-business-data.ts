/**
 * ADR 0006 存量清库（一次性，可重复执行，幂等）：
 *
 * 只清专辑/照片相关业务数据——Album / Photo / PhotoRendition / AlbumPhoto /
 * ImportJob / ImportItem / PhotoTag / Tag / FeaturedPhoto / NetdiskPushFailure，
 * 以及 SiteSetting.netdiskScanReport 扫描报告字段值。
 *
 * 项目设置原样保留：SiteSetting 整表（含 netdiskManagedFiles 托管清单、
 * netdiskDailyScan 等字段）、Admin、BaiduCredential。
 * 网盘侧文件一律不动（删除不变量：系统永不删除网盘文件）。
 *
 * 运行（在 apps/api 下执行）：
 *   cd apps/api && bun run --env-file=../../.env ../../scripts/clear-adr0006-business-data.ts
 *
 * 注意：不使用 prisma migrate reset（那是全库重置，会连项目设置一起清掉）。
 */
import { Prisma, PrismaClient } from "@prisma/client";

process.env.DATABASE_URL ??=
  "postgresql://photo:photo@localhost:5432/photo?schema=public";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // 按外键依赖从叶到根逐表 DELETE（级联也可，但显式按表更直观、可核对行数）
  const featured = await prisma.featuredPhoto.deleteMany({});
  const pushFailures = await prisma.netdiskPushFailure.deleteMany({});
  const importItems = await prisma.importItem.deleteMany({});
  const importJobs = await prisma.importJob.deleteMany({});
  const renditions = await prisma.photoRendition.deleteMany({});
  const photoTags = await prisma.photoTag.deleteMany({});
  const memberships = await prisma.albumPhoto.deleteMany({});
  const photos = await prisma.photo.deleteMany({});
  const albums = await prisma.album.deleteMany({});
  const tags = await prisma.tag.deleteMany({});

  // 扫描报告字段值清空（SiteSetting 行本身与其余字段原样保留）
  await prisma.siteSetting.updateMany({
    data: { netdiskScanReport: Prisma.DbNull },
  });

  console.log(
    [
      `FeaturedPhoto: -${featured.count}`,
      `NetdiskPushFailure: -${pushFailures.count}`,
      `ImportJob: -${importJobs.count}`,
      `ImportItem: -${importItems.count}`,
      `PhotoRendition: -${renditions.count}`,
      `PhotoTag: -${photoTags.count}`,
      `AlbumPhoto: -${memberships.count}`,
      `Photo: -${photos.count}`,
      `Album: -${albums.count}`,
      `Tag: -${tags.count}`,
      "SiteSetting.netdiskScanReport: cleared",
      "保留：SiteSetting（含 netdiskManagedFiles）/ Admin / BaiduCredential / 网盘文件",
    ].join("\n"),
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
