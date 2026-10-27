import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TagController } from "./tag.controller.js";
import { TagService } from "./tag.service.js";

@Module({
  imports: [AuthModule],
  controllers: [TagController],
  providers: [TagService],
})
export class TagModule {}
