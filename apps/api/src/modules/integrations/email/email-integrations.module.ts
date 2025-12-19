import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../prisma/prisma.module";
import { AuditModule } from "../../audit/audit.module";
import { WorkspaceMemberGuard } from "../../../tenancy/workspace-member.guard";
import { UsersModule } from "../../users/users.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { EmailIntegrationsController } from "./email-integrations.controller";
import { EmailIntegrationsService } from "./email-integrations.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule, AuditModule],
  controllers: [EmailIntegrationsController],
  providers: [EmailIntegrationsService, WorkspaceMemberGuard],
})
export class EmailIntegrationsModule {}
