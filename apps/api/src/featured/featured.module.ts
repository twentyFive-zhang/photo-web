import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FeaturedController } from "./featured.controller.js";
import { FeaturedService } from "./featured.service.js";
import { FeaturedPublicController } from "./featured-public.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [FeaturedController, FeaturedPublicController],
  providers: [FeaturedService],
})
export class FeaturedModule {}
