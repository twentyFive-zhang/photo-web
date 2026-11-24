-- P2 统一登录（DESIGN.md §1）：Admin 增加 IdP subject。
-- 可空 + 唯一：现有本地账号保持 sub = NULL（break-glass 应急账号，保留密码登录），
-- OIDC 首登自动建号时写入（此类账号不可再密码登录）。
-- AlterTable
ALTER TABLE "Admin" ADD COLUMN "sub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Admin_sub_key" ON "Admin"("sub");
