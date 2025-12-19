import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { RateLimit } from "../../common/security/rate-limit.decorator";
import { RateLimitGuard } from "../../common/security/rate-limit.guard";
import { UsersService } from "../users/users.service";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { InvitesService } from "./invites.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller()
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly users: UsersService,
  ) {}

  @Post("/invites/accept")
  @UseGuards(RateLimitGuard)
  @RateLimit({ key: "invites_accept", windowMs: 60_000, max: 3 })
  @HttpCode(200)
  async accept(@Req() req: AuthedRequest, @Body() body: AcceptInviteDto) {
    const user = await this.users.getOrCreateFromToken(req.user);
    return this.invites.acceptInvite({ token: body.token, userId: user.id, userEmail: user.email });
  }
}
