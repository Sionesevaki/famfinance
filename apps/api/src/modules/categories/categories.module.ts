import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, WorkspaceMemberGuard],
})
export class CategoriesModule {}

