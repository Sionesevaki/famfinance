import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { workspaceId: string; q?: string; limit?: number; offset?: number }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;
    const q = params.q?.trim() || undefined;

    const categories = await this.prisma.category.findMany({
      where: {
        workspaceId: params.workspaceId,
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      skip: offset,
      take: limit,
    });

    return categories.map((c) => ({ categoryId: c.id, name: c.name }));
  }

  async create(params: { workspaceId: string; name: string }) {
    const name = params.name.trim();
    const cat = await this.prisma.category.upsert({
      where: { workspaceId_name: { workspaceId: params.workspaceId, name } },
      update: {},
      create: { workspaceId: params.workspaceId, name },
    });
    return { categoryId: cat.id, name: cat.name };
  }
}

