import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { KeycloakToken } from "../../common/auth/keycloak-jwt.guard";
import { UpdateMeDto } from "./dto/update-me.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateFromToken(token: KeycloakToken) {
    const email =
      token.email ??
      (typeof token.preferred_username === "string" ? token.preferred_username : undefined);
    if (!email) throw new BadRequestException("Token missing email");

    const subject = token.sub;
    if (subject) {
      const existing = await this.prisma.user.findUnique({ where: { keycloakSub: subject } });
      if (existing) return existing;

      const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
      if (existingByEmail) {
        // If the user was created via email fallback earlier, upgrade keycloakSub once we see a real subject.
        if (existingByEmail.keycloakSub.startsWith("email:")) {
          return this.prisma.user.update({
            where: { id: existingByEmail.id },
            data: { keycloakSub: subject },
          });
        }
        return existingByEmail;
      }

      return this.prisma.user.create({
        data: {
          keycloakSub: subject,
          email,
          fullName: typeof token.name === "string" ? token.name : null,
        },
      });
    }

    // Defensive fallback: Keycloak OIDC tokens should always include `sub`. If a token is missing it,
    // use email as a temporary stable identifier to unblock access and allow later migration to real `sub`.
    const fallbackKeycloakSub = `email:${email.toLowerCase()}`;

    const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingByEmail) return existingByEmail;

    return this.prisma.user.create({
      data: {
        keycloakSub: fallbackKeycloakSub,
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
