import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { workspaceId: string; q?: string; limit?: number; offset?: number }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;
    const q = params.q?.trim() || undefined;

    const merchants = await this.prisma.merchant.findMany({
      where: {
        workspaceId: params.workspaceId,
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      skip: offset,
      take: limit,
    });

    return merchants.map((m) => ({ merchantId: m.id, name: m.name }));
  }
}

