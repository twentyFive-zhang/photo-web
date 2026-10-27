import { Controller, Delete, Get, Param, UseGuards } from "@nestjs/common";
import type { Tag } from "@photo/shared";
import { AdminGuard } from "../common/admin.guard.js";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { TagService } from "./tag.service.js";

@Controller("admin/tags")
@UseGuards(AdminGuard)
export class TagController {
  constructor(private readonly tagService: TagService) {}

  @Get()
  list(): Promise<Tag[]> {
    return this.tagService.list();
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<void> {
    await this.tagService.remove(id);
  }
}
