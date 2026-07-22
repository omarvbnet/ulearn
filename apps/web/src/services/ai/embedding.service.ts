import { createHash } from "crypto";
import { AiProviderService } from "./ai-provider.service";
import { EMBEDDING_DIMS } from "./types";

export class EmbeddingService {
  static async embedText(text: string, userId?: string): Promise<number[]> {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return Array(EMBEDDING_DIMS).fill(0);
    return AiProviderService.embed(cleaned, userId);
  }

  static hashQuestion(normalized: string, stageId?: string | null, subjectId?: string | null) {
    return createHash("sha256")
      .update(`${normalized}|${stageId || ""}|${subjectId || ""}`)
      .digest("hex");
  }

  static normalizeQuestion(q: string) {
    return q
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
}
