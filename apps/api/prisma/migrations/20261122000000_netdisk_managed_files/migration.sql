-- 托管文件登记：直接上传到网盘、不属于照片流程的文件 fsId/path 列表（ADR 0004）。
-- 持久化在 SiteSetting 单行的 JSON 列，下行扫描据此跳过托管文件（不入 Photo 表）。
ALTER TABLE "SiteSetting" ADD COLUMN "netdiskManagedFiles" JSONB;
