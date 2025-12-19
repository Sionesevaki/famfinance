import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth/public.decorator";

@Controller()
export class HealthController {
  @Get("/health")
  @Public()
  health() {
    return { status: "ok" };
  }
}

