import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersService } from "../users/users.service";
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { ListCategoriesQuery } from "./dto/list-categories.query";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller("/workspaces/:workspaceId/categories")
@UseGuards(WorkspaceMemberGuard)
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListCategoriesQuery,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.categories.list({ workspaceId, q: query.q, limit: query.limit, offset: query.offset });
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Param("workspaceId") workspaceId: string, @Body() body: CreateCategoryDto) {
    await this.users.getOrCreateFromToken(req.user);
    return this.categories.create({ workspaceId, name: body.name });
  }
}

