import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { Request } from "express";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { UpdateMeDto } from "./dto/update-me.dto";
import { UsersService } from "./users.service";

type AuthedRequest = Request & { user: KeycloakToken };

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("/me")
  async me(@Req() req: AuthedRequest) {
    const user = await this.users.getOrCreateFromToken(req.user);
    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  @Patch("/me")
  async updateMe(@Req() req: AuthedRequest, @Body() body: UpdateMeDto) {
    const user = await this.users.getOrCreateFromToken(req.user);
    const updated = await this.users.updateProfile(user.id, body);
    return { id: updated.id, email: updated.email, fullName: updated.fullName };
  }
}

