import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { UpdateMeDto } from "./dto/update-me.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateFromToken(token: KeycloakToken) {
    const sub = token.sub;
    if (!sub) throw new BadRequestException("Token missing sub");

    const existing = await this.prisma.user.findUnique({ where: { keycloakSub: sub } });
    if (existing) return existing;

    const email =
      token.email ??
      (typeof token.preferred_username === "string" ? token.preferred_username : undefined);
    if (!email) throw new BadRequestException("Token missing email");

    return this.prisma.user.create({
      data: {
        keycloakSub: sub,
        email,
        fullName: typeof token.name === "string" ? token.name : null,
      },
    });
  }

  async updateProfile(userId: string, body: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fullName: body.fullName },
    });
  }
}

