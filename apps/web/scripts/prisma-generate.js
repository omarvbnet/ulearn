/**
 * Generate Prisma Client for the current DATABASE_URL shape.
 *
 * Accelerate / Prisma Postgres (`prisma://`, `prisma+postgres://`) →
 *   `prisma generate --no-engine` (queries go through Accelerate HTTP).
 * Plain postgres / pooled URLs →
 *   normal `prisma generate` (needs the query engine binary).
 */
const { spawnSync } = require("child_process");

function isAccelerateUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("prisma://") ||
    url.startsWith("prisma+postgres://") ||
    url.includes("accelerate.prisma-data.net")
  );
}

const useNoEngine =
  process.env.PRISMA_GENERATE_NO_ENGINE === "1" ||
  isAccelerateUrl(process.env.PRISMA_ACCELERATE_URL) ||
  isAccelerateUrl(process.env.DATABASE_URL);

const args = ["generate"];
if (useNoEngine) {
  args.push("--no-engine");
  console.log("prisma generate --no-engine (Accelerate URL detected)");
} else {
  console.log("prisma generate (local query engine)");
}

const result = spawnSync("npx", ["prisma", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(result.status ?? 1);
