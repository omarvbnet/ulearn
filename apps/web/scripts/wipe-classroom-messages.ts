import { prisma } from "../src/lib/prisma";

/** Remove AI-chat messages that carry classroom lesson payloads or
 * classroom-start bubbles, so no classroom remnants show in app history. */
async function main() {
  const withLesson = await prisma.$executeRawUnsafe(
    `DELETE FROM "AiMessage" WHERE "citations"::text LIKE '%aiTeacherLesson%'`
  );
  console.log(`AiMessage with aiTeacherLesson payload: deleted ${withLesson}`);

  const phrases = [
    "الفصل المباشر جاهز:%",
    "الدرس المباشر جاهز:%",
    "Live classroom ready:%",
    "Live lesson ready:%",
    "Canlı sınıf hazır:%",
    "Canlı ders hazır:%",
    "ابدأ الدرس المباشر على السبورة",
    "ابدأ درس السبورة الصوتي%",
    "Start the live whiteboard classroom",
    "Start the live whiteboard lesson",
    "جاري فتح الدرس المباشر…",
    "Opening the live classroom…",
    "Opening the live lesson…",
  ];
  const byContent = await prisma.$executeRawUnsafe(
    `DELETE FROM "AiMessage" WHERE ${phrases
      .map((_, i) => `"content" LIKE $${i + 1}`)
      .join(" OR ")}`,
    ...phrases
  );
  console.log(`AiMessage classroom bubbles: deleted ${byContent}`);

  // Drop now-empty conversations so they don't show as blank threads.
  const emptyConvos = await prisma.$executeRawUnsafe(
    `DELETE FROM "AiConversation" c WHERE NOT EXISTS
       (SELECT 1 FROM "AiMessage" m WHERE m."conversationId" = c."id")`
  );
  console.log(`Empty AiConversation rows: deleted ${emptyConvos}`);
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
