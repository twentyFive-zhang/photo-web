-- 网盘镜像同步：Photo.netdiskFsId 映射、待确认删除表、每日扫描开关
ALTER TABLE "Photo" ADD COLUMN "netdiskFsId" TEXT;
CREATE UNIQUE INDEX "Photo_netdiskFsId_key" ON "Photo"("netdiskFsId");

ALTER TABLE "SiteSetting" ADD COLUMN "netdiskDailyScan" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "NetdiskPendingDelete" (
    "id" TEXT NOT NULL,
    "netdiskFsId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "albumTitle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetdiskPendingDelete_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetdiskPendingDelete_netdiskFsId_key" ON "NetdiskPendingDelete"("netdiskFsId");

ALTER TABLE "Photo" ADD COLUMN "netdiskPath" TEXT;

ALTER TABLE "SiteSetting" ADD COLUMN "netdiskScanReport" JSONB;
