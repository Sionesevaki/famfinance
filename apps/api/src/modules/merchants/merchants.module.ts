import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { MerchantsController } from "./merchants.controller";
import { MerchantsService } from "./merchants.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [MerchantsController],
  providers: [MerchantsService, WorkspaceMemberGuard],
})
export class MerchantsModule {}

