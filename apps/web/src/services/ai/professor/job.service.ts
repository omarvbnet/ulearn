import { prisma } from "@/lib/prisma";
import type { ProfessorJobStatus, ProfessorJobType, Prisma } from "@prisma/client";

export class ProfessorJobService {
  static async create(input: {
    instructorId: string;
    type: ProfessorJobType;
    inputJson?: Prisma.InputJsonValue;
    documentId?: string;
    generationId?: string;
  }) {
    return prisma.professorJob.create({
      data: {
        instructorId: input.instructorId,
        type: input.type,
        status: "QUEUED",
        progress: 0,
        inputJson: input.inputJson,
        documentId: input.documentId,
        generationId: input.generationId,
      },
    });
  }

  static async get(instructorId: string, id: string) {
    return prisma.professorJob.findFirst({
      where: { id, instructorId },
    });
  }

  static async list(instructorId: string, take = 50) {
    return prisma.professorJob.findMany({
      where: { instructorId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  static async update(
    id: string,
    data: {
      status?: ProfessorJobStatus;
      progress?: number;
      errorMessage?: string | null;
      resultJson?: Prisma.InputJsonValue;
      completedAt?: Date | null;
    }
  ) {
    return prisma.professorJob.update({
      where: { id },
      data: {
        ...data,
        ...(data.status === "SUCCEEDED" || data.status === "FAILED"
          ? { completedAt: data.completedAt ?? new Date() }
          : {}),
      },
    });
  }

  static async markRunning(id: string, progress = 5) {
    return this.update(id, { status: "RUNNING", progress });
  }

  static async markProgress(id: string, progress: number) {
    return this.update(id, { progress: Math.min(99, Math.max(0, progress)) });
  }

  static async markSucceeded(id: string, resultJson?: Prisma.InputJsonValue) {
    return this.update(id, {
      status: "SUCCEEDED",
      progress: 100,
      resultJson,
      completedAt: new Date(),
    });
  }

  static async markFailed(id: string, errorMessage: string) {
    return this.update(id, {
      status: "FAILED",
      errorMessage,
      completedAt: new Date(),
    });
  }

  /** Fire-and-forget runner with progress + error capture. */
  static enqueue(
    jobId: string,
    runner: (report: (progress: number) => Promise<void>) => Promise<unknown>
  ) {
    void (async () => {
      try {
        await this.markRunning(jobId);
        const result = await runner(async (progress) => {
          await this.markProgress(jobId, progress);
        });
        const resultJson =
          result === undefined || result === null
            ? undefined
            : (JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue);
        await this.markSucceeded(jobId, resultJson);
      } catch (e) {
        await this.markFailed(
          jobId,
          e instanceof Error ? e.message : "Job failed"
        );
      }
    })();
  }
}
