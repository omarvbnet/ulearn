import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, maskConnectionUrl, normalizePostgresUrl } from "@/lib/db-crypto";
import { LoggingService } from "@/services/logging.service";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type DbProviderKind =
  | "PRISMA_POSTGRES"
  | "SUPABASE"
  | "VPS_POSTGRES"
  | "LOCAL_CUSTOM";

export type DbProviderProfile = {
  id: string;
  name: string;
  kind: DbProviderKind;
  /** Encrypted DATABASE_URL (Accelerate / pooled). */
  databaseUrlEnc: string;
  /** Encrypted direct Postgres URL for migrate / bulk copy. */
  directUrlEnc: string;
  /** Optional Accelerate URL if DATABASE_URL stays as direct. */
  accelerateUrlEnc?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
  /** Last successful tester-data transfer probe (required before migrate). */
  lastTransferTestAt?: string | null;
  lastTransferTestOk?: boolean | null;
  lastTransferTestSummary?: string | null;
};

export type DbProvidersConfig = {
  version: 1;
  activeProviderId: string | null;
  /** Set after a successful migrate; admin must update env & redeploy to finish. */
  pendingActivationId: string | null;
  profiles: DbProviderProfile[];
  updatedAt: string;
};

export type PublicDbProviderProfile = Omit<
  DbProviderProfile,
  "databaseUrlEnc" | "directUrlEnc" | "accelerateUrlEnc"
> & {
  databaseUrlMasked: string;
  directUrlMasked: string;
  hasAccelerateUrl: boolean;
};

const SETTINGS_KEY = "database_providers";
const LOCAL_FILE = path.join(process.cwd(), ".data", "db-providers.json");

/**
 * Parent → child export order so imports can run with FKs enabled.
 * Models not listed are appended alphabetically at the end.
 */
const EXPORT_ORDER: string[] = [
  "Country",
  "Province",
  "EducationalStage",
  "Subject",
  "Chapter",
  "Lesson",
  "LessonContent",
  "User",
  "StudentProfile",
  "CertificateProfile",
  "CertificateProfileInterest",
  "TeacherProfile",
  "TeacherSubject",
  "Device",
  "Session",
  "OtpCode",
  "SubscriptionPackage",
  "ActivationRequest",
  "ActivationCode",
  "Subscription",
  "Course",
  "CourseLesson",
  "CourseMaterial",
  "CoursePurchase",
  "CourseReaction",
  "CourseFavorite",
  "CourseRating",
  "CourseLessonProgress",
  "CourseLessonLike",
  "CourseLessonFavorite",
  "CourseLessonQuestion",
  "CourseLessonAnswer",
  "CourseLessonUpdateRequest",
  "CourseGroup",
  "CourseGroupItem",
  "CourseGroupPurchase",
  "Quiz",
  "QuizQuestion",
  "QuizAttempt",
  "LessonQuestion",
  "LessonAnswer",
  "TeacherShortVideo",
  "ShortVideoLike",
  "ShortVideoComment",
  "ShortVideoSave",
  "TeacherRating",
  "VideoAsset",
  "VideoProgress",
  "Advertisement",
  "AdLike",
  "Product",
  "ProductPurchase",
  "IntroOutro",
  "Notification",
  "UserNotification",
  "Complaint",
  "ContentReport",
  "StageChangeRequest",
  "Certificate",
  "DailyActivity",
  "SystemSetting",
  "AuditLog",
  "AiProvider",
  "AiModuleAssignment",
  "AiUsageLog",
  "AiConversation",
  "AiMessage",
  "AiResponseCache",
  "AiExamAttempt",
  "AiCreativeJob",
  "AiIapPurchase",
  "KbDocument",
  "KbDocumentVersion",
  "KbChunk",
  "StudentAiMemory",
  "ProfessorJob",
  "ProfessorGeneration",
  "ProfessorArtifact",
  "ProfessorQuestionBankItem",
];

function modelDelegate(client: PrismaClient, modelName: string) {
  const key = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const delegate = (client as unknown as Record<string, { findMany?: Function; createMany?: Function; deleteMany?: Function; count?: Function }>)[key];
  if (!delegate?.findMany) {
    throw new Error(`Unknown Prisma model: ${modelName}`);
  }
  return delegate;
}

function emptyConfig(): DbProvidersConfig {
  return {
    version: 1,
    activeProviderId: null,
    pendingActivationId: null,
    profiles: [],
    updatedAt: new Date().toISOString(),
  };
}

function toPublic(p: DbProviderProfile): PublicDbProviderProfile {
  let databaseUrlMasked = "(not set)";
  let directUrlMasked = "(not set)";
  try {
    databaseUrlMasked = maskConnectionUrl(decryptSecret(p.databaseUrlEnc));
  } catch {
    databaseUrlMasked = "(invalid)";
  }
  try {
    directUrlMasked = maskConnectionUrl(decryptSecret(p.directUrlEnc));
  } catch {
    directUrlMasked = "(invalid)";
  }
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    notes: p.notes ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    lastTestedAt: p.lastTestedAt ?? null,
    lastTestOk: p.lastTestOk ?? null,
    lastTransferTestAt: p.lastTransferTestAt ?? null,
    lastTransferTestOk: p.lastTransferTestOk ?? null,
    lastTransferTestSummary: p.lastTransferTestSummary ?? null,
    databaseUrlMasked,
    directUrlMasked,
    hasAccelerateUrl: Boolean(p.accelerateUrlEnc),
  };
}

/**
 * Temporary clients for test / migrate / probe must use a real Postgres URL.
 * Accelerate (`prisma://`) only works for the app's primary client.
 */
function assertDirectPostgresUrl(url: string, label = "DIRECT_DATABASE_URL") {
  try {
    return normalizePostgresUrl(url, { allowAccelerate: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: ${msg}`);
  }
}

function createClient(databaseUrl: string): PrismaClient {
  const url = assertDirectPostgresUrl(databaseUrl);
  return new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
}

async function persistLocalCopy(config: DbProvidersConfig) {
  try {
    await mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await writeFile(LOCAL_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.warn("[db-providers] local file backup failed", err);
  }
}

export class DatabaseProviderService {
  static async getConfig(): Promise<DbProvidersConfig> {
    const row = await prisma.systemSetting.findFirst({
      where: { key: SETTINGS_KEY, countryId: null },
    });
    if (row?.value && typeof row.value === "object") {
      return row.value as DbProvidersConfig;
    }
    try {
      const raw = await readFile(LOCAL_FILE, "utf8");
      return JSON.parse(raw) as DbProvidersConfig;
    } catch {
      return emptyConfig();
    }
  }

  static async saveConfig(config: DbProvidersConfig, actorId: string) {
    const next = { ...config, updatedAt: new Date().toISOString() };
    const existing = await prisma.systemSetting.findFirst({
      where: { key: SETTINGS_KEY, countryId: null },
    });
    if (existing) {
      await prisma.systemSetting.update({
        where: { id: existing.id },
        data: { value: next, updatedBy: actorId },
      });
    } else {
      await prisma.systemSetting.create({
        data: {
          key: SETTINGS_KEY,
          countryId: null,
          value: next,
          updatedBy: actorId,
        },
      });
    }
    await persistLocalCopy(next);
    return next;
  }

  static async listPublic() {
    const config = await this.getConfig();
    const current = {
      databaseUrlMasked: maskConnectionUrl(process.env.DATABASE_URL || ""),
      directUrlMasked: maskConnectionUrl(
        process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || ""
      ),
      usesAccelerate: Boolean(
        process.env.PRISMA_ACCELERATE_URL ||
          process.env.DATABASE_URL?.startsWith("prisma://") ||
          process.env.DATABASE_URL?.startsWith("prisma+postgres://")
      ),
      hostHint: (() => {
        try {
          const u = new URL(
            (process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "").replace(
              /^prisma\+?postgres:/,
              "postgres:"
            )
          );
          return u.host;
        } catch {
          return null;
        }
      })(),
    };
    return {
      config: {
        ...config,
        profiles: config.profiles.map(toPublic),
      },
      current,
      kinds: [
        {
          id: "PRISMA_POSTGRES",
          label: "Prisma Postgres / Accelerate",
          hint: "prisma:// or prisma+postgres:// pooled URL + direct postgresql://",
        },
        {
          id: "SUPABASE",
          label: "Supabase Postgres",
          hint: "Use Transaction pooler or direct connection string from Supabase",
        },
        {
          id: "VPS_POSTGRES",
          label: "VPS / self-hosted Postgres",
          hint: "postgresql://user:pass@your-vps-ip:5432/ulearn",
        },
        {
          id: "LOCAL_CUSTOM",
          label: "Local / custom Postgres",
          hint: "localhost or any custom host",
        },
      ] as const,
    };
  }

  static async upsertProfile(
    input: {
      id?: string;
      name: string;
      kind: DbProviderKind;
      databaseUrl: string;
      directUrl: string;
      accelerateUrl?: string | null;
      notes?: string | null;
    },
    actorId: string
  ) {
    if (!input.name.trim()) throw new Error("NAME_REQUIRED");
    if (!input.databaseUrl.trim() || !input.directUrl.trim()) {
      throw new Error("URLS_REQUIRED");
    }

    // Validate + normalize before encrypt (catches bad ports / unescaped passwords early)
    const databaseUrl = normalizePostgresUrl(input.databaseUrl, { allowAccelerate: true });
    const directUrl = normalizePostgresUrl(input.directUrl, { allowAccelerate: false });
    const accelerateUrl = input.accelerateUrl?.trim()
      ? normalizePostgresUrl(input.accelerateUrl, { allowAccelerate: true })
      : null;

    const config = await this.getConfig();
    const now = new Date().toISOString();
    const id = input.id || `dbp_${randomId()}`;
    const existingIdx = config.profiles.findIndex((p) => p.id === id);

    const profile: DbProviderProfile = {
      id,
      name: input.name.trim(),
      kind: input.kind,
      databaseUrlEnc: encryptSecret(databaseUrl),
      directUrlEnc: encryptSecret(directUrl),
      accelerateUrlEnc: accelerateUrl ? encryptSecret(accelerateUrl) : null,
      notes: input.notes?.trim() || null,
      createdAt: existingIdx >= 0 ? config.profiles[existingIdx].createdAt : now,
      updatedAt: now,
      lastTestedAt: existingIdx >= 0 ? config.profiles[existingIdx].lastTestedAt : null,
      lastTestOk: existingIdx >= 0 ? config.profiles[existingIdx].lastTestOk : null,
      lastTransferTestAt:
        existingIdx >= 0 ? config.profiles[existingIdx].lastTransferTestAt : null,
      lastTransferTestOk:
        existingIdx >= 0 ? config.profiles[existingIdx].lastTransferTestOk : null,
      lastTransferTestSummary:
        existingIdx >= 0 ? config.profiles[existingIdx].lastTransferTestSummary : null,
    };

    if (existingIdx >= 0) config.profiles[existingIdx] = profile;
    else config.profiles.push(profile);

    await this.saveConfig(config, actorId);
    await LoggingService.log({
      actorId,
      action: existingIdx >= 0 ? "UPDATE_DB_PROVIDER" : "CREATE_DB_PROVIDER",
      entityType: "DatabaseProvider",
      entityId: id,
      newValue: { name: profile.name, kind: profile.kind },
    });
    return toPublic(profile);
  }

  static async deleteProfile(id: string, actorId: string) {
    const config = await this.getConfig();
    const before = config.profiles.length;
    config.profiles = config.profiles.filter((p) => p.id !== id);
    if (config.activeProviderId === id) config.activeProviderId = null;
    if (config.pendingActivationId === id) config.pendingActivationId = null;
    if (config.profiles.length === before) throw new Error("NOT_FOUND");
    await this.saveConfig(config, actorId);
    await LoggingService.log({
      actorId,
      action: "DELETE_DB_PROVIDER",
      entityType: "DatabaseProvider",
      entityId: id,
    });
    return { success: true as const };
  }

  static async testConnection(opts: {
    providerId?: string;
    databaseUrl?: string;
    directUrl?: string;
  }) {
    let databaseUrl = opts.databaseUrl?.trim();
    let directUrl = opts.directUrl?.trim();

    if (opts.providerId) {
      const config = await this.getConfig();
      const p = config.profiles.find((x) => x.id === opts.providerId);
      if (!p) throw new Error("NOT_FOUND");
      databaseUrl = decryptSecret(p.databaseUrlEnc);
      directUrl = decryptSecret(p.directUrlEnc);
    }

    if (!directUrl && !databaseUrl) throw new Error("URL_REQUIRED");

    // Prefer DIRECT (session/direct Postgres). Never run $queryRaw against prisma://.
    let url: string;
    if (directUrl?.trim()) {
      url = assertDirectPostgresUrl(directUrl, "DIRECT_DATABASE_URL");
    } else if (databaseUrl && /^(prisma\+|prisma:)/i.test(databaseUrl.trim())) {
      throw new Error(
        "DIRECT_DATABASE_URL_REQUIRED: DATABASE_URL is Accelerate (prisma://). Paste a postgresql:// direct/session URL to test or migrate (e.g. Supabase Database → URI)."
      );
    } else {
      url = assertDirectPostgresUrl(databaseUrl!, "DATABASE_URL");
    }

    const client = createClient(url);
    const started = Date.now();
    try {
      await client.$queryRaw`SELECT 1`;
      const tables = await client.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;
      const userCount = await client.user.count().catch(() => -1);
      const latencyMs = Date.now() - started;

      if (opts.providerId) {
        const config = await this.getConfig();
        const p = config.profiles.find((x) => x.id === opts.providerId);
        if (p) {
          p.lastTestedAt = new Date().toISOString();
          p.lastTestOk = true;
          p.updatedAt = p.lastTestedAt;
          await this.saveConfig(config, "system");
        }
      }

      return {
        ok: true as const,
        latencyMs,
        tableCount: Number(tables[0]?.count ?? 0),
        userCount,
        urlMasked: maskConnectionUrl(url),
      };
    } catch (err) {
      if (opts.providerId) {
        const config = await this.getConfig();
        const p = config.profiles.find((x) => x.id === opts.providerId);
        if (p) {
          p.lastTestedAt = new Date().toISOString();
          p.lastTestOk = false;
          await this.saveConfig(config, "system");
        }
      }
      return {
        ok: false as const,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        urlMasked: maskConnectionUrl(url),
      };
    } finally {
      await client.$disconnect().catch(() => {});
    }
  }

  static async exportBackup(actorId: string) {
    const models = await this.orderedModels();
    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const model of models) {
      try {
        const rows = await modelDelegate(prisma, model).findMany!();
        tables[model] = rows as unknown[];
        counts[model] = (rows as unknown[]).length;
      } catch (err) {
        console.warn(`[db-export] skip ${model}`, err);
        tables[model] = [];
        counts[model] = 0;
      }
    }

    const payload = {
      format: "ulearn-db-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: actorId,
      source: {
        databaseUrlMasked: maskConnectionUrl(process.env.DATABASE_URL || ""),
        directUrlMasked: maskConnectionUrl(
          process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || ""
        ),
      },
      counts,
      tables,
    };

    await LoggingService.log({
      actorId,
      action: "EXPORT_DB_BACKUP",
      entityType: "DatabaseBackup",
      newValue: { totalRows: Object.values(counts).reduce((a, b) => a + b, 0), counts },
    });

    return payload;
  }

  static async importBackup(
    backup: {
      format?: string;
      version?: number;
      tables: Record<string, unknown[]>;
    },
    opts: {
      actorId: string;
      /** Import into another provider (direct URL). Default = current DB. */
      targetProviderId?: string;
      wipeTarget?: boolean;
    }
  ) {
    if (!backup?.tables || typeof backup.tables !== "object") {
      throw new Error("INVALID_BACKUP");
    }

    let client = prisma as PrismaClient;
    let owned: PrismaClient | null = null;
    let targetLabel = "current";

    if (opts.targetProviderId) {
      const config = await this.getConfig();
      const p = config.profiles.find((x) => x.id === opts.targetProviderId);
      if (!p) throw new Error("NOT_FOUND");
      const url = decryptSecret(p.directUrlEnc);
      owned = createClient(url);
      client = owned;
      targetLabel = p.name;
    }

    const models = await this.orderedModels();
    const imported: Record<string, number> = {};
    const errors: { model: string; error: string }[] = [];

    try {
      // Disable FK checks for bulk load when possible (Postgres).
      await client.$executeRawUnsafe(`SET session_replication_role = 'replica'`).catch(() => {});

      if (opts.wipeTarget) {
        for (const model of [...models].reverse()) {
          try {
            await modelDelegate(client, model).deleteMany!({});
          } catch (err) {
            errors.push({
              model,
              error: `wipe: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }

      for (const model of models) {
        const rows = backup.tables[model];
        if (!Array.isArray(rows) || rows.length === 0) {
          imported[model] = 0;
          continue;
        }
        try {
          // createMany skips duplicates if skipDuplicates; chunk for size.
          const chunkSize = 500;
          let n = 0;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const result = await modelDelegate(client, model).createMany!({
              data: chunk,
              skipDuplicates: true,
            });
            n += result?.count ?? chunk.length;
          }
          imported[model] = n;
        } catch (err) {
          // Fallback: row-by-row upsert-ish create
          let n = 0;
          for (const row of rows) {
            try {
              await (modelDelegate(client, model) as { create: Function }).create({
                data: row,
              });
              n += 1;
            } catch {
              // skip conflicting row
            }
          }
          imported[model] = n;
          if (n === 0) {
            errors.push({
              model,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      await client.$executeRawUnsafe(`SET session_replication_role = 'origin'`).catch(() => {});

      await LoggingService.log({
        actorId: opts.actorId,
        action: "IMPORT_DB_BACKUP",
        entityType: "DatabaseBackup",
        newValue: {
          target: targetLabel,
          wipeTarget: Boolean(opts.wipeTarget),
          imported,
          errorCount: errors.length,
        },
      });

      return {
        success: true as const,
        target: targetLabel,
        imported,
        errors,
        totalImported: Object.values(imported).reduce((a, b) => a + b, 0),
      };
    } finally {
      if (owned) await owned.$disconnect().catch(() => {});
    }
  }

  /**
   * Safe migrate: export current → import into target (optional wipe) → mark pending activation.
   * Requires a successful transfer probe first so tester data proves the target works.
   * Does NOT change process.env; returns the env values admin must set + redeploy.
   */
  static async migrateToProvider(
    providerId: string,
    actorId: string,
    opts?: { wipeTarget?: boolean; skipProbeGate?: boolean }
  ) {
    const config = await this.getConfig();
    const profile = config.profiles.find((p) => p.id === providerId);
    if (!profile) throw new Error("NOT_FOUND");

    if (!opts?.skipProbeGate && !this.isTransferProbeFresh(profile)) {
      return {
        success: false as const,
        error: "TRANSFER_TEST_REQUIRED",
        message:
          "Run “Transfer test” successfully before migrating. This seeds tester data and verifies the target can receive project data safely.",
      };
    }

    const test = await this.testConnection({ providerId });
    if (!test.ok) {
      return { success: false as const, error: "TARGET_UNREACHABLE", test };
    }

    // Re-run probe immediately before full copy (unless explicitly skipped).
    if (!opts?.skipProbeGate) {
      const probe = await this.runTransferProbe(providerId, actorId);
      if (!probe.ok) {
        return {
          success: false as const,
          error: "TRANSFER_TEST_FAILED",
          probe,
        };
      }
    }

    const backup = await this.exportBackup(actorId);
    const sourceTotal = Object.values(backup.counts).reduce((a, b) => a + b, 0);

    const imported = await this.importBackup(backup, {
      actorId,
      targetProviderId: providerId,
      wipeTarget: opts?.wipeTarget ?? false,
    });

    // After full import, re-seed tester data and verify the target still accepts writes.
    const postProbe = await this.runTransferProbe(providerId, actorId, {
      cleanup: true,
    });
    if (!postProbe.ok) {
      return {
        success: false as const,
        error: "POST_MIGRATE_TRANSFER_TEST_FAILED",
        message:
          "Data was copied, but the post-migrate transfer test failed. Do not switch env yet — fix the target and re-run Transfer test / Migrate.",
        probe: postProbe,
        import: imported,
        sourceTotal,
      };
    }

    config.pendingActivationId = providerId;
    const p = config.profiles.find((x) => x.id === providerId);
    if (p) {
      p.lastTransferTestAt = new Date().toISOString();
      p.lastTransferTestOk = true;
      p.lastTransferTestSummary = postProbe.summary;
    }
    await this.saveConfig(config, actorId);

    const databaseUrl = decryptSecret(profile.databaseUrlEnc);
    const directUrl = decryptSecret(profile.directUrlEnc);
    const accelerateUrl = profile.accelerateUrlEnc
      ? decryptSecret(profile.accelerateUrlEnc)
      : null;

    await LoggingService.log({
      actorId,
      action: "MIGRATE_DB_PROVIDER",
      entityType: "DatabaseProvider",
      entityId: providerId,
      newValue: {
        sourceTotal,
        importedTotal: imported.totalImported,
        wipeTarget: Boolean(opts?.wipeTarget),
        postProbeOk: true,
      },
    });

    return {
      success: true as const,
      provider: toPublic(
        config.profiles.find((x) => x.id === providerId) ?? profile
      ),
      sourceTotal,
      import: imported,
      transferProbe: postProbe,
      activation: {
        pending: true,
        instructions: [
          "1. Confirm transfer test + row counts on the target look correct.",
          "2. Set these environment variables on the host (Vercel / VPS / local .env).",
          "3. Run `npx prisma migrate deploy` against DIRECT_DATABASE_URL if the target was empty.",
          "4. Redeploy / restart the app so it picks up the new URLs.",
          "5. Open Admin → Database Providers and click “Confirm activated”.",
        ],
        env: {
          DATABASE_URL: databaseUrl,
          DIRECT_DATABASE_URL: directUrl,
          ...(accelerateUrl ? { PRISMA_ACCELERATE_URL: accelerateUrl } : {}),
        },
      },
    };
  }

  static async confirmActivated(providerId: string, actorId: string) {
    const config = await this.getConfig();
    const profile = config.profiles.find((p) => p.id === providerId);
    if (!profile) throw new Error("NOT_FOUND");
    if (!this.isTransferProbeFresh(profile)) {
      throw new Error("TRANSFER_TEST_REQUIRED");
    }
    config.activeProviderId = providerId;
    config.pendingActivationId = null;
    await this.saveConfig(config, actorId);
    await LoggingService.log({
      actorId,
      action: "ACTIVATE_DB_PROVIDER",
      entityType: "DatabaseProvider",
      entityId: providerId,
    });
    return { success: true as const, provider: toPublic(profile) };
  }

  /**
   * Seeds identifiable tester data on the current DB, copies it to the target,
   * verifies round-trip integrity, then cleans up. Must pass before migrate/activate.
   */
  static async runTransferProbe(
    providerId: string,
    actorId: string,
    opts?: { cleanup?: boolean }
  ) {
    const cleanup = opts?.cleanup !== false;
    const config = await this.getConfig();
    const profile = config.profiles.find((p) => p.id === providerId);
    if (!profile) throw new Error("NOT_FOUND");

    const conn = await this.testConnection({ providerId });
    if (!conn.ok) {
      await this.markTransferProbe(config, profile.id, false, "Target unreachable", actorId);
      return {
        ok: false as const,
        summary: "Target unreachable",
        steps: [{ step: "connect", ok: false, detail: conn.error || "failed" }],
      };
    }

    const target = createClient(decryptSecret(profile.directUrlEnc));
    const token = `dbprobe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const phone = `+9647000${String(Date.now()).slice(-7)}`;
    const probeKey = `db_transfer_probe_${token}`;
    const steps: { step: string; ok: boolean; detail: string }[] = [];

    let sourceUserId: string | null = null;
    let sourceSettingId: string | null = null;
    let sourceDeviceId: string | null = null;
    let sourceAdId: string | null = null;
    let targetUserId: string | null = null;
    let targetSettingId: string | null = null;
    let targetDeviceId: string | null = null;
    let targetAdId: string | null = null;

    try {
      // ── 1. Seed on source ─────────────────────────────────────
      const country = await prisma.country.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      });
      const stage = country
        ? await prisma.educationalStage.findFirst({
            where: { countryId: country.id, deletedAt: null, isActive: true },
            orderBy: { sortOrder: "asc" },
          })
        : null;

      const user = await prisma.user.create({
        data: {
          phone,
          fullLegalName: `[DB-TRANSFER-TEST] ${token}`,
          email: `${token}@db-transfer.test`,
          role: "STUDENT",
          status: "APPROVED",
          locale: "EN",
          countryId: country?.id,
          nationalId: `TEST-${token}`,
          ...(stage
            ? {
                studentProfile: {
                  create: {
                    educationalStageId: stage.id,
                    grade: "probe",
                    schoolUniversity: "DB Transfer Probe School",
                  },
                },
              }
            : {}),
        },
      });
      sourceUserId = user.id;
      steps.push({ step: "seed_user", ok: true, detail: user.id });

      const device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceId: `probe-device-${token}`,
          deviceName: "Transfer Probe Device",
          platform: "test",
          isActive: true,
        },
      });
      sourceDeviceId = device.id;
      steps.push({ step: "seed_device", ok: true, detail: device.id });

      const setting = await prisma.systemSetting.create({
        data: {
          key: probeKey,
          countryId: null,
          value: {
            token,
            phone,
            userId: user.id,
            deviceId: device.id,
            seededAt: new Date().toISOString(),
            purpose: "db_transfer_probe",
          },
          updatedBy: actorId,
        },
      });
      sourceSettingId = setting.id;
      steps.push({ step: "seed_setting", ok: true, detail: setting.id });

      const ad = await prisma.advertisement.create({
        data: {
          locale: "EN",
          title: `[DB-TRANSFER-TEST] ${token}`,
          titleEn: `[DB-TRANSFER-TEST] ${token}`,
          imageUrl: `https://example.com/db-probe/${token}.png`,
          linkUrl: `ulearn://db-probe/${token}`,
          sortOrder: 99999,
          isActive: false,
          countryId: country?.id,
        },
      });
      sourceAdId = ad.id;
      steps.push({ step: "seed_ad", ok: true, detail: ad.id });

      // ── 2. Copy to target ─────────────────────────────────────
      // Ensure country exists on target if we referenced one
      let targetCountryId = country?.id ?? null;
      if (country) {
        const existingCountry = await target.country.findUnique({
          where: { id: country.id },
        });
        if (!existingCountry) {
          try {
            await target.country.create({
              data: {
                id: country.id,
                code: country.code,
                nameEn: country.nameEn,
                nameAr: country.nameAr,
                nameKu: country.nameKu,
                nameTr: country.nameTr,
                isActive: country.isActive,
              },
            });
            steps.push({
              step: "ensure_country",
              ok: true,
              detail: "copied country to target",
            });
          } catch (err) {
            // Target may already have same code different id — use that
            const byCode = await target.country.findFirst({
              where: { code: country.code, deletedAt: null },
            });
            targetCountryId = byCode?.id ?? null;
            steps.push({
              step: "ensure_country",
              ok: Boolean(byCode),
              detail: byCode
                ? `reused country ${byCode.id}`
                : err instanceof Error
                  ? err.message
                  : "failed",
            });
          }
        }
      }

      let targetStageId = stage?.id ?? null;
      if (stage && targetCountryId) {
        const existingStage = await target.educationalStage.findUnique({
          where: { id: stage.id },
        });
        if (!existingStage) {
          try {
            await target.educationalStage.create({
              data: {
                id: stage.id,
                countryId: targetCountryId,
                nameEn: stage.nameEn,
                nameAr: stage.nameAr,
                nameKu: stage.nameKu,
                nameTr: stage.nameTr,
                sortOrder: stage.sortOrder,
                isActive: stage.isActive,
                isCertificateTrack: stage.isCertificateTrack,
              },
            });
          } catch {
            const alt = await target.educationalStage.findFirst({
              where: { countryId: targetCountryId, deletedAt: null },
            });
            targetStageId = alt?.id ?? null;
          }
        }
      }

      const targetUser = await target.user.create({
        data: {
          id: user.id,
          phone: user.phone,
          fullLegalName: user.fullLegalName,
          email: user.email,
          role: user.role,
          status: user.status,
          locale: user.locale,
          countryId: targetCountryId,
          nationalId: user.nationalId,
          ...(targetStageId
            ? {
                studentProfile: {
                  create: {
                    educationalStageId: targetStageId,
                    grade: "probe",
                    schoolUniversity: "DB Transfer Probe School",
                  },
                },
              }
            : {}),
        },
      });
      targetUserId = targetUser.id;
      steps.push({
        step: "copy_user",
        ok: targetUser.id === user.id,
        detail: targetUser.id,
      });

      const targetDevice = await target.device.create({
        data: {
          id: device.id,
          userId: targetUser.id,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          platform: device.platform,
          isActive: true,
        },
      });
      targetDeviceId = targetDevice.id;
      steps.push({
        step: "copy_device",
        ok: targetDevice.id === device.id,
        detail: targetDevice.id,
      });

      const targetSetting = await target.systemSetting.create({
        data: {
          id: setting.id,
          key: probeKey,
          countryId: null,
          value: setting.value as object,
          updatedBy: actorId,
        },
      });
      targetSettingId = targetSetting.id;
      steps.push({
        step: "copy_setting",
        ok: targetSetting.id === setting.id,
        detail: targetSetting.id,
      });

      const targetAd = await target.advertisement.create({
        data: {
          id: ad.id,
          locale: ad.locale,
          title: ad.title,
          titleEn: ad.titleEn,
          imageUrl: ad.imageUrl,
          linkUrl: ad.linkUrl,
          sortOrder: ad.sortOrder,
          isActive: false,
          countryId: targetCountryId,
        },
      });
      targetAdId = targetAd.id;
      steps.push({
        step: "copy_ad",
        ok: targetAd.id === ad.id,
        detail: targetAd.id,
      });

      // ── 3. Verify on target ───────────────────────────────────
      const verifyUser = await target.user.findUnique({
        where: { id: user.id },
        include: { studentProfile: true, devices: true },
      });
      const verifySetting = await target.systemSetting.findFirst({
        where: { key: probeKey },
      });
      const verifyAd = await target.advertisement.findUnique({
        where: { id: ad.id },
      });

      const userOk =
        !!verifyUser &&
        verifyUser.phone === phone &&
        verifyUser.fullLegalName === user.fullLegalName &&
        verifyUser.email === user.email;
      const settingOk =
        !!verifySetting &&
        typeof verifySetting.value === "object" &&
        verifySetting.value !== null &&
        (verifySetting.value as { token?: string }).token === token;
      const deviceOk = (verifyUser?.devices?.length ?? 0) >= 1;
      const adOk = !!verifyAd && verifyAd.imageUrl === ad.imageUrl;

      steps.push({
        step: "verify_user",
        ok: userOk,
        detail: userOk ? "phone/name/email match" : "mismatch or missing",
      });
      steps.push({
        step: "verify_device",
        ok: deviceOk,
        detail: deviceOk ? "device present" : "device missing",
      });
      steps.push({
        step: "verify_setting",
        ok: settingOk,
        detail: settingOk ? "probe token match" : "setting missing/mismatch",
      });
      steps.push({
        step: "verify_ad",
        ok: adOk,
        detail: adOk ? "ad row match" : "ad missing/mismatch",
      });

      const ok = userOk && settingOk && deviceOk && adOk;
      const summary = ok
        ? `Transfer probe passed (${token}) — user, device, setting, ad verified on target`
        : `Transfer probe failed (${token}) — see steps`;

      await this.markTransferProbe(config, profile.id, ok, summary, actorId);

      await LoggingService.log({
        actorId,
        action: "DB_TRANSFER_PROBE",
        entityType: "DatabaseProvider",
        entityId: providerId,
        newValue: { ok, token, steps },
      });

      return { ok, summary, token, steps, phone };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      steps.push({ step: "exception", ok: false, detail });
      const summary = `Transfer probe error: ${detail}`;
      await this.markTransferProbe(config, profile.id, false, summary, actorId);
      return { ok: false as const, summary, steps };
    } finally {
      if (cleanup) {
        // Clean target then source so production stays clean.
        try {
          if (targetAdId) {
            await target.advertisement.delete({ where: { id: targetAdId } }).catch(() => {});
          }
          if (targetSettingId) {
            await target.systemSetting.delete({ where: { id: targetSettingId } }).catch(() => {});
          }
          if (targetDeviceId) {
            await target.device.delete({ where: { id: targetDeviceId } }).catch(() => {});
          }
          if (targetUserId) {
            await target.user.delete({ where: { id: targetUserId } }).catch(() => {});
          }
        } catch {
          /* ignore cleanup errors */
        }
        try {
          if (sourceAdId) {
            await prisma.advertisement.delete({ where: { id: sourceAdId } }).catch(() => {});
          }
          if (sourceSettingId) {
            await prisma.systemSetting.delete({ where: { id: sourceSettingId } }).catch(() => {});
          }
          if (sourceDeviceId) {
            await prisma.device.delete({ where: { id: sourceDeviceId } }).catch(() => {});
          }
          if (sourceUserId) {
            await prisma.user.delete({ where: { id: sourceUserId } }).catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      await target.$disconnect().catch(() => {});
    }
  }

  private static isTransferProbeFresh(profile: DbProviderProfile): boolean {
    if (!profile.lastTransferTestOk || !profile.lastTransferTestAt) return false;
    const age = Date.now() - new Date(profile.lastTransferTestAt).getTime();
    // Probe valid for 24 hours.
    return age >= 0 && age < 24 * 60 * 60 * 1000;
  }

  private static async markTransferProbe(
    config: DbProvidersConfig,
    providerId: string,
    ok: boolean,
    summary: string,
    actorId: string
  ) {
    const p = config.profiles.find((x) => x.id === providerId);
    if (!p) return;
    p.lastTransferTestAt = new Date().toISOString();
    p.lastTransferTestOk = ok;
    p.lastTransferTestSummary = summary;
    p.updatedAt = p.lastTransferTestAt;
    await this.saveConfig(config, actorId);
  }

  static async compareCounts(providerId: string) {
    const config = await this.getConfig();
    const profile = config.profiles.find((p) => p.id === providerId);
    if (!profile) throw new Error("NOT_FOUND");

    const models = ["User", "Course", "CoursePurchase", "Subscription", "Advertisement", "SystemSetting"];
    const current: Record<string, number> = {};
    const target: Record<string, number> = {};

    for (const m of models) {
      current[m] = await modelDelegate(prisma, m).count!().catch(() => -1);
    }

    const client = createClient(decryptSecret(profile.directUrlEnc));
    try {
      for (const m of models) {
        target[m] = await modelDelegate(client, m).count!().catch(() => -1);
      }
    } finally {
      await client.$disconnect().catch(() => {});
    }

    return { current, target, matched: models.every((m) => current[m] === target[m]) };
  }

  private static async orderedModels(): Promise<string[]> {
    const known = new Set(EXPORT_ORDER);
    // Discover any extra models from the runtime client that we missed.
    const extras: string[] = [];
    for (const key of Object.keys(prisma)) {
      if (key.startsWith("$") || key.startsWith("_")) continue;
      const name = key.charAt(0).toUpperCase() + key.slice(1);
      if (!known.has(name) && typeof (prisma as never as Record<string, unknown>)[key] === "object") {
        const d = (prisma as never as Record<string, { findMany?: unknown }>)[key];
        if (typeof d?.findMany === "function") extras.push(name);
      }
    }
    extras.sort();
    return [...EXPORT_ORDER, ...extras.filter((e) => !known.has(e))];
  }
}

function randomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
