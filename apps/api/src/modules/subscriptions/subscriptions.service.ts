import { Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdateSubscriptionDto } from "./dto/update-subscription.dto";

@Injectable()
export class SubscriptionsService implements OnModuleDestroy {
  private readonly detectQueue = new Queue("subscription_detect", {
    connection: { url: requireEnv("REDIS_URL") },
  });

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await this.detectQueue.close();
  }

  async enqueueDetect(workspaceId: string) {
    const job = await this.detectQueue.add(
      "subscription_detect",
      { workspaceId },
      {
        jobId: `subscription_detect-${workspaceId}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    return job.id;
  }

  async list(workspaceId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: { workspaceId },
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
      include: { merchant: { select: { id: true, name: true } } },
    });

    return subs.map((s) => ({
      subscriptionId: s.id,
      name: s.name,
      interval: s.interval,
      amountCents: s.amountCents,
      currency: s.currency,
      lastChargedAt: s.lastChargedAt,
      nextDueAt: s.nextDueAt,
      active: s.active,
      merchant: s.merchant ? { merchantId: s.merchant.id, name: s.merchant.name } : null,
    }));
  }

  async update(workspaceId: string, subscriptionId: string, body: UpdateSubscriptionDto) {
    const existing = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, workspaceId },
    });
    if (!existing) throw new NotFoundException("Subscription not found");

    const updated = await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        active: typeof body.active === "boolean" ? body.active : undefined,
        interval: body.interval ?? undefined,
      },
    });

    return { subscriptionId: updated.id, active: updated.active, interval: updated.interval };
  }
}
