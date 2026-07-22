/**
 * Always generate Prisma Client WITH the query engine.
 *
 * Admin → Database Providers opens temporary clients against arbitrary
 * `postgresql://` targets (Supabase, VPS, local). A client built with
 * `--no-engine` only accepts `prisma://` and rejects those URLs with:
 *   "the URL must start with the protocol prisma://"
 *
 * Accelerate still works at runtime via `withAccelerate()` when
 * DATABASE_URL / PRISMA_ACCELERATE_URL is `prisma://`.
 *
 * Opt-in only (not recommended): PRISMA_GENERATE_NO_ENGINE=1
 */
const { spawnSync } = require("child_process");

const useNoEngine = process.env.PRISMA_GENERATE_NO_ENGINE === "1";

const args = ["generate"];
if (useNoEngine) {
  args.push("--no-engine");
  console.warn(
    "prisma generate --no-engine: Database Providers cannot test/migrate postgresql:// targets"
  );
} else {
  console.log("prisma generate (query engine included for multi-provider support)");
}

const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(result.status ?? 1);
