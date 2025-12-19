import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRoleGuard } from "../../tenancy/workspace-role.guard";
import { UsersModule } from "../users/users.module";
import { WorkspaceMembersController } from "./workspace-members.controller";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [WorkspacesController, WorkspaceMembersController],
  providers: [WorkspacesService, WorkspaceMemberGuard, WorkspaceRoleGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
