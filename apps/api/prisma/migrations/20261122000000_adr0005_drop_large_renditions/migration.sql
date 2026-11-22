-- ADR 0005：母版权威反转到网盘，本地发布库只存 thumb(400) + display(1600)。
-- large(2560) 档移除：先清存量行，再重建枚举类型（PostgreSQL 不支持 DROP VALUE）。
DELETE FROM "PhotoRendition" WHERE variant = 'LARGE';

CREATE TYPE "PhotoVariant_new" AS ENUM ('THUMB', 'DISPLAY');

ALTER TABLE "PhotoRendition" ALTER COLUMN variant TYPE "PhotoVariant_new" USING variant::text::"PhotoVariant_new";

DROP TYPE "PhotoVariant";
ALTER TYPE "PhotoVariant_new" RENAME TO "PhotoVariant";
