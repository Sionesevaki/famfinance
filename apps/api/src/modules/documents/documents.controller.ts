import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersService } from "../users/users.service";
import { DocumentsService } from "./documents.service";
import { PresignUploadDto } from "./dto/presign-upload.dto";
import { ListDocumentsQuery } from "./dto/list-documents.query";

type AuthedRequest = Request & { user: KeycloakToken; localUserId?: string };

@Controller("/workspaces/:workspaceId/documents")
@UseGuards(WorkspaceMemberGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly users: UsersService,
  ) {}

  @Post("upload-url")
  async presignUpload(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Body() body: PresignUploadDto,
  ) {
    const user = await this.users.getOrCreateFromToken(req.user);
    return this.documents.createUploadUrl({
      workspaceId,
      uploadedById: user.id,
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      type: body.type,
    });
  }

  @Post(":documentId/complete")
  @HttpCode(200)
  async complete(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("documentId") documentId: string,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    await this.documents.completeUpload({ workspaceId, documentId });
    return { queued: true };
  }

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListDocumentsQuery,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.documents.listDocuments({
      workspaceId,
      type: query.type,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(":documentId")
  async get(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("documentId") documentId: string,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.documents.getDocument({ workspaceId, documentId });
  }

  @Get(":documentId/download-url")
  async downloadUrl(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("documentId") documentId: string,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.documents.getDownloadUrl({ workspaceId, documentId });
  }

  @Delete(":documentId")
  @HttpCode(200)
  async remove(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("documentId") documentId: string,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    await this.documents.softDelete({ workspaceId, documentId });
    return { deleted: true };
  }
}

