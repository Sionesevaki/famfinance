import { Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { Queue, type JobJson } from "bullmq";
import { requireEnv } from "@famfinance/lib";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await Promise.all(Array.from(this.queues.values()).map((q) => q.close()));
    this.queues.clear();
  }

  async listWorkspaces() {
    const rows = await this.prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        currency: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    return rows.map((w) => ({
      workspaceId: w.id,
      name: w.name,
      currency: w.currency,
      createdAt: w.createdAt,
      deletedAt: w.deletedAt,
    }));
  }

  async listUsers() {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
      },
    });

    return rows.map((u) => ({
      userId: u.id,
      email: u.email,
      fullName: u.fullName,
      createdAt: u.createdAt,
    }));
  }

  async listFailedJobs(params: { queue: string; limit?: number; offset?: number }) {
    const queue = this.getQueue(params.queue);
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const jobs = await queue.getFailed(offset, offset + limit - 1);
    return jobs.map((j) => this.toJobSummary(j.asJSON()));
  }

  async retryJob(params: { queue: string; jobId: string }) {
    const queue = this.getQueue(params.queue);
    const job = await queue.getJob(params.jobId);
    if (!job) throw new NotFoundException("Job not found");
    await job.retry();
    return { retried: true };
  }

  async metrics() {
    const [users, workspaces] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.workspace.count(),
    ]);

    const queues = ["doc_extract", "normalize", "tx_upsert", "rollup_monthly", "email_sync", "email_parse", "subscription_detect"];
    const queueStats = await Promise.all(
      queues.map(async (name) => {
        const q = this.getQueue(name);
        const counts = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
        return [name, counts] as const;
      }),
    );

    return {
      users,
      workspaces,
      queues: Object.fromEntries(queueStats),
    };
  }

  async metricsPrometheus() {
    const metrics = await this.metrics();

    const lines: string[] = [];
    lines.push("# HELP famfinance_users_total Total users");
    lines.push("# TYPE famfinance_users_total gauge");
    lines.push(`famfinance_users_total ${metrics.users}`);

    lines.push("# HELP famfinance_workspaces_total Total workspaces");
    lines.push("# TYPE famfinance_workspaces_total gauge");
    lines.push(`famfinance_workspaces_total ${metrics.workspaces}`);

    const queueNames = Object.keys(metrics.queues);
    lines.push("# HELP famfinance_queue_jobs Number of jobs by state");
    lines.push("# TYPE famfinance_queue_jobs gauge");

    for (const queue of queueNames) {
      const counts = (metrics.queues as Record<string, Record<string, number>>)[queue];
      for (const [state, value] of Object.entries(counts)) {
        lines.push(`famfinance_queue_jobs{queue="${queue}",state="${state}"} ${value}`);
      }
    }

    return lines.join("\n") + "\n";
  }

  private getQueue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, { connection: { url: requireEnv("REDIS_URL") } });
    this.queues.set(name, queue);
    return queue;
  }

  private toJobSummary(j: JobJson) {
    return {
      jobId: j.id,
      name: j.name,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason ?? null,
      timestamp: j.timestamp ?? null,
      processedOn: j.processedOn ?? null,
      finishedOn: j.finishedOn ?? null,
    };
  }
}
