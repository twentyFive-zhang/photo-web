import { Controller, Get } from "@nestjs/common";
import type { PublicFeaturedPhoto } from "@photo/shared";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { FeaturedService } from "./featured.service.js";

/** 公开精选：前台首页展示，照片可来自任意专辑（人工策划）。 */
@Controller("featured")
export class FeaturedPublicController {
  constructor(private readonly featuredService: FeaturedService) {}

  @Get()
  list(): Promise<PublicFeaturedPhoto[]> {
    return this.featuredService.listPublic();
  }
}
