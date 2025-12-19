import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, WorkspaceMemberGuard],
})
export class AnalyticsModule {}

