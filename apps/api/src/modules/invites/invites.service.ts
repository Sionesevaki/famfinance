import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InviteStatus, WorkspaceRole } from "@famfinance/db";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvite(params: {
    workspaceId: string;
    invitedById: string;
    invitedEmail: string;
    role: WorkspaceRole;
  }) {
    const invitedEmail = normalizeEmail(params.invitedEmail);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const existingUser = await this.prisma.user.findUnique({ where: { email: invitedEmail } });
    if (existingUser) {
      const existingMember = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: params.workspaceId, userId: existingUser.id } },
      });
      if (existingMember) throw new BadRequestException("User is already a member of this workspace");
    }

    const existingInvite = await this.prisma.workspaceInvite.findFirst({
      where: {
        workspaceId: params.workspaceId,
        invitedEmail,
        status: InviteStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvite) throw new BadRequestException("A pending invite already exists for this email");

    const token = randomBytes(INVITE_TOKEN_BYTES).toString("hex");
    const tokenHash = sha256Hex(token);

    const invite = await this.prisma.workspaceInvite.create({
      data: {
        workspaceId: params.workspaceId,
        invitedById: params.invitedById,
        invitedEmail,
        role: params.role,
        tokenHash,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    return { inviteId: invite.id, expiresAt: invite.expiresAt, tokenForTestOnly: token };
  }

  async listInvites(workspaceId: string) {
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        invitedEmail: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
    });

    return invites.map((i) => ({
      inviteId: i.id,
      invitedEmail: i.invitedEmail,
      role: i.role,
      status: i.status,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      acceptedAt: i.acceptedAt,
      revokedAt: i.revokedAt,
    }));
  }

  async revokeInvite(workspaceId: string, inviteId: string) {
    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: inviteId, workspaceId },
    });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.status !== InviteStatus.PENDING) throw new BadRequestException("Invite is not pending");

    await this.prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: InviteStatus.REVOKED, revokedAt: new Date() },
    });
  }

  async acceptInvite(params: { token: string; userId: string; userEmail: string }) {
    const now = new Date();
    const tokenHash = sha256Hex(params.token);
    const userEmail = normalizeEmail(params.userEmail);

    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.workspaceInvite.findUnique({ where: { tokenHash } });
      if (!invite) throw new BadRequestException("Invalid invite token");
      if (invite.status !== InviteStatus.PENDING) throw new BadRequestException("Invite is not pending");

      if (invite.expiresAt <= now) {
        await tx.workspaceInvite.update({
          where: { id: invite.id },
          data: { status: InviteStatus.EXPIRED },
        });
        throw new BadRequestException("Invite has expired");
      }

      if (normalizeEmail(invite.invitedEmail) !== userEmail) {
        throw new ForbiddenException("Invite is for a different email address");
      }

      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: params.userId } },
      });
      if (existing) throw new BadRequestException("User is already a member of this workspace");

      await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: params.userId,
          role: invite.role,
        },
      });

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.ACCEPTED, acceptedAt: now },
      });

      return { workspaceId: invite.workspaceId, membershipRole: invite.role };
    });
  }
}

