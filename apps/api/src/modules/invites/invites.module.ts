import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { WorkspaceRoleGuard } from "../../tenancy/workspace-role.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AuditModule } from "../audit/audit.module";
import { InvitesController } from "./invites.controller";
import { InvitesService } from "./invites.service";
import { WorkspaceInvitesController } from "./workspace-invites.controller";
import { RateLimitGuard } from "../../common/security/rate-limit.guard";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule, AuditModule],
  controllers: [InvitesController, WorkspaceInvitesController],
  providers: [InvitesService, WorkspaceMemberGuard, WorkspaceRoleGuard, RateLimitGuard],
})
export class InvitesModule {}
