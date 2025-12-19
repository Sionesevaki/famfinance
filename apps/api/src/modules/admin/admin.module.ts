import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import { UsersModule } from "../users/users.module";
import { AuditModule } from "../audit/audit.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [PrismaModule, UsersModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, PlatformAdminGuard],
})
export class AdminModule {}
