import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, WorkspaceMemberGuard],
})
export class TransactionsModule {}

