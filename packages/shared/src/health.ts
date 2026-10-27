import { z } from "zod";

export const SITE_NAME = "江流儿摄影";
export const API_PREFIX = "/api";

export const apiHealthSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string(),
});

export type ApiHealth = z.infer<typeof apiHealthSchema>;
