import { Prisma } from "@prisma/client";

/** P2025：目标记录不存在（已被删除或从未创建）。 */
export const isMissingRecordError = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2025";

/** P2003：外键约束失败（引用的目标行不存在，如专辑在写入前被删）。 */
export const isForeignKeyViolation = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2003";
