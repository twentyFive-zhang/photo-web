import { z } from "zod";

export const visibilitySchema = z.enum(["PUBLIC", "UNLISTED"]);
export type Visibility = z.infer<typeof visibilitySchema>;

/** 后台管理员（不含密码哈希）。日期为 ISO 字符串。 */
export const adminSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string(),
});
export type Admin = z.infer<typeof adminSchema>;

export const loginInputSchema = z.object({
  username: z.string().min(1, "用户名不能为空"),
  password: z.string().min(1, "密码不能为空"),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1, "当前密码不能为空"),
  newPassword: z
    .string()
    .min(8, "新密码至少 8 位")
    .max(128, "新密码最长 128 位"),
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
