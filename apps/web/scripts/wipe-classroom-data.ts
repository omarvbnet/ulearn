import { prisma } from "../src/lib/prisma";

/** One-shot cleanup: remove every classroom session + per-material
 * classroom progress so all students start Live Lesson fresh. */
async function main() {
  const sessions = await prisma.aiClassroomSession.count();
  const del = await prisma.aiClassroomSession.deleteMany({});
  console.log(`AiClassroomSession: deleted ${del.count}/${sessions}`);

  const cleared = await prisma.$executeRawUnsafe(
    'UPDATE "StudentAiMemory" SET "materialProgress" = NULL, "conceptMastery" = NULL, "completedLessons" = \'{}\''
  );
  console.log(`StudentAiMemory: cleared classroom progress on ${cleared} rows`);
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
