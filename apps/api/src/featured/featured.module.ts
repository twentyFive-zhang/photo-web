import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FeaturedController } from "./featured.controller.js";
import { FeaturedService } from "./featured.service.js";

@Module({
  imports: [AuthModule],
  controllers: [FeaturedController],
  providers: [FeaturedService],
})
export class FeaturedModule {}
