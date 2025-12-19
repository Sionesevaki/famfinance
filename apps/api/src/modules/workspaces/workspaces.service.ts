import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceRole } from "@famfinance/db";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(userId: string, body: CreateWorkspaceDto) {
    return this.prisma.workspace.create({
      data: {
        name: body.name,
        currency: body.currency ?? "EUR",
        members: {
          create: { userId, role: WorkspaceRole.OWNER },
        },
      },
    });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: "desc" },
    });

    return memberships.map((m) => ({
      workspaceId: m.workspaceId,
      name: m.workspace.name,
      currency: m.workspace.currency,
      role: m.role,
    }));
  }

  async requireMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new ForbiddenException("Not a workspace member");
    return membership;
  }

  async getWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws || ws.deletedAt) throw new NotFoundException("Workspace not found");
    return {
      workspaceId: ws.id,
      name: ws.name,
      currency: ws.currency,
    };
  }

  async updateWorkspace(
    workspaceId: string,
    role: WorkspaceRole,
    body: Partial<CreateWorkspaceDto>,
  ) {
    if (role !== WorkspaceRole.OWNER && role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException("Insufficient role");
    }

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: typeof body.name === "string" ? body.name : undefined,
        currency: typeof body.currency === "string" ? body.currency : undefined,
      },
      select: { id: true, name: true, currency: true },
    });
  }

  async listMembers(workspaceId: string) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return members.map((m) => ({
      memberId: m.id,
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      role: m.role,
      createdAt: m.createdAt,
    }));
  }

  async updateMemberRole(workspaceId: string, memberId: string, newRole: WorkspaceRole) {
    if (newRole === WorkspaceRole.OWNER) {
      throw new ForbiddenException("Cannot assign OWNER via this endpoint");
    }

    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.role === WorkspaceRole.OWNER) throw new ForbiddenException("Cannot change OWNER role");

    const updated = await this.prisma.workspaceMember.update({
      where: { id: member.id },
      data: { role: newRole },
    });

    return { memberId: updated.id, role: updated.role };
  }

  async removeMember(
    workspaceId: string,
    memberId: string,
    requester: { userId: string; role: WorkspaceRole; id: string },
  ) {
    const target = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!target) throw new NotFoundException("Member not found");
    if (target.role === WorkspaceRole.OWNER) throw new ForbiddenException("Cannot remove OWNER");

    if (requester.role === WorkspaceRole.ADMIN && target.role !== WorkspaceRole.MEMBER) {
      throw new ForbiddenException("Admins can only remove MEMBER users");
    }

    await this.prisma.workspaceMember.delete({ where: { id: target.id } });
  }
}
