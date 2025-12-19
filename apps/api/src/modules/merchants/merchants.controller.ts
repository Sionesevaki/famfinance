import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { WorkspaceMemberGuard } from "../../tenancy/workspace-member.guard";
import { UsersService } from "../users/users.service";
import { ListMerchantsQuery } from "./dto/list-merchants.query";
import { MerchantsService } from "./merchants.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller("/workspaces/:workspaceId/merchants")
@UseGuards(WorkspaceMemberGuard)
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListMerchantsQuery,
  ) {
    await this.users.getOrCreateFromToken(req.user);
    return this.merchants.list({ workspaceId, q: query.q, limit: query.limit, offset: query.offset });
  }
}

