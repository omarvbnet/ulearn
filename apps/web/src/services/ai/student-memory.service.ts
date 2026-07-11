import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export class StudentMemoryService {
  static async getOrCreate(userId: string) {
    const existing = await prisma.studentAiMemory.findUnique({ where: { userId } });
    if (existing) return existing;
    return prisma.studentAiMemory.create({ data: { userId } });
  }

  static toPromptBlurb(memory: {
    weakSubjects: string[];
    strongSubjects: string[];
    preferredStyle: string | null;
    learningSpeed: string | null;
  }) {
    const bits: string[] = [];
    if (memory.weakSubjects.length) bits.push(`weaker topics: ${memory.weakSubjects.slice(0, 5).join(", ")}`);
    if (memory.strongSubjects.length)
      bits.push(`stronger topics: ${memory.strongSubjects.slice(0, 5).join(", ")}`);
    if (memory.preferredStyle) bits.push(`style: ${memory.preferredStyle}`);
    if (memory.learningSpeed) bits.push(`pace: ${memory.learningSpeed}`);
    return bits.join("; ");
  }

  static async recordQuestion(userId: string, question: string, subjectId?: string | null) {
    const mem = await this.getOrCreate(userId);
    const faq = (Array.isArray(mem.frequentQuestions) ? mem.frequentQuestions : []) as {
      q: string;
      count: number;
    }[];
    const key = question.slice(0, 120).toLowerCase();
    const found = faq.find((f) => f.q === key);
    if (found) found.count += 1;
    else faq.unshift({ q: key, count: 1 });
    const trimmed = faq.slice(0, 40);

    const weak = [...mem.weakSubjects];
    if (subjectId && !weak.includes(subjectId) && weak.length < 20) weak.push(subjectId);

    await prisma.studentAiMemory.update({
      where: { userId },
      data: {
        frequentQuestions: trimmed as Prisma.InputJsonValue,
        weakSubjects: weak,
      },
    });
  }
}
