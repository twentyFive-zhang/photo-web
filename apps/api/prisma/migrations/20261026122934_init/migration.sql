-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'UNLISTED');

-- CreateEnum
CREATE TYPE "PhotoVariant" AS ENUM ('THUMB', 'DISPLAY', 'LARGE');

-- CreateEnum
CREATE TYPE "ImageFormat" AS ENUM ('WEBP', 'JPEG');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('BAIDU', 'LOCAL');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportItemStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'PROCESSING', 'SUCCEEDED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverPhotoId" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'UNLISTED',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "originalKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "exif" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoRendition" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "variant" "PhotoVariant" NOT NULL,
    "format" "ImageFormat" NOT NULL,
    "key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,

    CONSTRAINT "PhotoRendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoTag" (
    "photoId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "PhotoTag_pkey" PRIMARY KEY ("photoId","tagId")
);

-- CreateTable
CREATE TABLE "FeaturedPhoto" (
    "photoId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedPhoto_pkey" PRIMARY KEY ("photoId")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "albumId" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportItemStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "photoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaiduCredential" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaiduCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "siteName" TEXT NOT NULL DEFAULT '江流儿摄影',
    "siteDescription" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT,
    "wechatQrKey" TEXT,
    "socialLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Album_publicId_key" ON "Album"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Album_shareToken_key" ON "Album"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Album_coverPhotoId_key" ON "Album"("coverPhotoId");

-- CreateIndex
CREATE INDEX "Album_visibility_publishedAt_idx" ON "Album"("visibility", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_publicId_key" ON "Photo"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_originalKey_key" ON "Photo"("originalKey");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_sha256_key" ON "Photo"("sha256");

-- CreateIndex
CREATE INDEX "Photo_albumId_sortOrder_idx" ON "Photo"("albumId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoRendition_key_key" ON "PhotoRendition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoRendition_photoId_variant_format_key" ON "PhotoRendition"("photoId", "variant", "format");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "PhotoTag_tagId_idx" ON "PhotoTag"("tagId");

-- CreateIndex
CREATE INDEX "FeaturedPhoto_sortOrder_idx" ON "FeaturedPhoto"("sortOrder");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_albumId_idx" ON "ImportJob"("albumId");

-- CreateIndex
CREATE INDEX "ImportItem_jobId_idx" ON "ImportItem"("jobId");

-- CreateIndex
CREATE INDEX "ImportItem_status_idx" ON "ImportItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportItem_jobId_sourceFileId_key" ON "ImportItem"("jobId", "sourceFileId");

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoRendition" ADD CONSTRAINT "PhotoRendition_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedPhoto" ADD CONSTRAINT "FeaturedPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportItem" ADD CONSTRAINT "ImportItem_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
