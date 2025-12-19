import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRoleGuard } from "../../tenancy/workspace-role.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, WorkspaceMemberGuard, WorkspaceRoleGuard],
})
export class SubscriptionsModule {}

