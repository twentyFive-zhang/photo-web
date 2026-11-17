-- 推送失败落库：Bull 重试耗尽后的持久化失败记录（admin 可见，重推成功或忽略后清除）
CREATE TABLE "NetdiskPushFailure" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "albumTitle" TEXT NOT NULL,
    "errno" INTEGER,
    "error" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetdiskPushFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetdiskPushFailure_photoId_key" ON "NetdiskPushFailure"("photoId");
CREATE INDEX "NetdiskPushFailure_attemptedAt_idx" ON "NetdiskPushFailure"("attemptedAt");

ALTER TABLE "NetdiskPushFailure" ADD CONSTRAINT "NetdiskPushFailure_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
