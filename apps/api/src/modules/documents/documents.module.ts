import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { S3Service } from "../../storage/s3.service";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersModule } from "../users/users.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [PrismaModule, UsersModule, WorkspacesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, S3Service, WorkspaceMemberGuard],
})
export class DocumentsModule {}

