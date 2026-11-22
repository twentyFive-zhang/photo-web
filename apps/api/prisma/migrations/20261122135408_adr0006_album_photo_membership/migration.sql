/*
  Warnings:

  - You are about to drop the column `albumId` on the `ImportJob` table. All the data in the column will be lost.
  - You are about to drop the column `albumTitle` on the `NetdiskPushFailure` table. All the data in the column will be lost.
  - You are about to drop the column `albumId` on the `Photo` table. All the data in the column will be lost.
  - You are about to drop the column `sortOrder` on the `Photo` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "ImportJob" DROP CONSTRAINT "ImportJob_albumId_fkey";

-- DropForeignKey
ALTER TABLE "Photo" DROP CONSTRAINT "Photo_albumId_fkey";

-- DropIndex
DROP INDEX "ImportJob_albumId_idx";

-- DropIndex
DROP INDEX "Photo_albumId_sortOrder_idx";

-- AlterTable
ALTER TABLE "ImportJob" DROP COLUMN "albumId";

-- AlterTable
ALTER TABLE "NetdiskPushFailure" DROP COLUMN "albumTitle";

-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "albumId",
DROP COLUMN "sortOrder";

-- CreateTable
CREATE TABLE "AlbumPhoto" (
    "albumId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumPhoto_pkey" PRIMARY KEY ("albumId","photoId")
);

-- CreateIndex
CREATE INDEX "AlbumPhoto_photoId_idx" ON "AlbumPhoto"("photoId");

-- CreateIndex
CREATE INDEX "AlbumPhoto_albumId_sortOrder_idx" ON "AlbumPhoto"("albumId", "sortOrder");

-- AddForeignKey
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
