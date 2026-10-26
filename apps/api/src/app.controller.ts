import { Controller, Get } from "@nestjs/common";
// biome-ignore lint/style/useImportType: NestJS DI needs the runtime import for constructor metadata
import { AppService } from "./app.service.js";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("health")
  getHealth() {
    return this.appService.getHealth();
  }
}
