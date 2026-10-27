import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import type { FeaturedItem, SetFeaturedInput } from "@photo/shared";
import { setFeaturedInputSchema } from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { FeaturedService } from "./featured.service.js";

@Controller("admin/featured")
@UseGuards(AdminGuard)
export class FeaturedController {
  constructor(private readonly featuredService: FeaturedService) {}

  @Get()
  list(): Promise<FeaturedItem[]> {
    return this.featuredService.list();
  }

  /** 全量替换精选列表（顺序即传入顺序）。 */
  @Put()
  set(
    @Body(new ZodValidationPipe(setFeaturedInputSchema))
    body: SetFeaturedInput,
  ): Promise<FeaturedItem[]> {
    return this.featuredService.set(body);
  }

  @Delete(":photoId")
  async remove(@Param("photoId") photoId: string): Promise<void> {
    await this.featuredService.remove(photoId);
  }
}
