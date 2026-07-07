import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  /* ── Countries & provinces ─────────────────────── */
  const iraq = await prisma.country.upsert({
    where: { code: "IQ" },
    update: {},
    create: {
      code: "IQ",
      nameEn: "Iraq",
      nameAr: "العراق",
      nameKu: "عێراق",
      nameTr: "Irak",
      provinces: {
        create: [
          { nameEn: "Baghdad", nameAr: "بغداد", nameKu: "بەغدا", nameTr: "Bağdat" },
          { nameEn: "Erbil", nameAr: "أربيل", nameKu: "هەولێر", nameTr: "Erbil" },
          { nameEn: "Basra", nameAr: "البصرة", nameKu: "بەسرە", nameTr: "Basra" },
          { nameEn: "Sulaymaniyah", nameAr: "السليمانية", nameKu: "سلێمانی", nameTr: "Süleymaniye" },
        ],
      },
    },
    include: { provinces: true },
  });

  const provinces =
    iraq.provinces?.length > 0
      ? iraq.provinces
      : await prisma.province.findMany({ where: { countryId: iraq.id } });
  const baghdad = provinces.find((p) => p.nameEn === "Baghdad") ?? provinces[0];
  const erbil = provinces.find((p) => p.nameEn === "Erbil") ?? provinces[0];

  await prisma.country.upsert({
    where: { code: "TR" },
    update: {},
    create: {
      code: "TR",
      nameEn: "Turkey",
      nameAr: "تركيا",
      nameKu: "تورکیا",
      nameTr: "Türkiye",
      provinces: {
        create: [
          { nameEn: "Istanbul", nameAr: "إسطنبول", nameKu: "ئیستانبوڵ", nameTr: "İstanbul" },
          { nameEn: "Ankara", nameAr: "أنقرة", nameKu: "ئەنقەرە", nameTr: "Ankara" },
        ],
      },
    },
  });

  /* ── Educational structure ─────────────────────── */
  let stage = await prisma.educationalStage.findFirst({
    where: { countryId: iraq.id, nameEn: "Secondary School" },
  });
  stage ??= await prisma.educationalStage.create({
    data: {
      countryId: iraq.id,
      nameEn: "Secondary School",
      nameAr: "المرحلة الثانوية",
      nameKu: "قۆناغی ناوەندی",
      nameTr: "Ortaokul",
      sortOrder: 1,
    },
  });

  let subject = await prisma.subject.findFirst({
    where: { countryId: iraq.id, nameEn: "Mathematics" },
  });
  subject ??= await prisma.subject.create({
    data: {
      countryId: iraq.id,
      stageId: stage.id,
      nameEn: "Mathematics",
      nameAr: "الرياضيات",
      nameKu: "بیرکاری",
      nameTr: "Matematik",
      totalHours: 40,
    },
  });

  let certProgram = await prisma.subject.findFirst({
    where: { countryId: iraq.id, nameEn: "Professional English" },
  });
  certProgram ??= await prisma.subject.create({
    data: {
      countryId: iraq.id,
      nameEn: "Professional English",
      nameAr: "الإنجليزية المهنية",
      nameKu: "ئینگلیزی پیشەیی",
      nameTr: "Mesleki İngilizce",
      isCertificateProgram: true,
      totalHours: 20,
    },
  });

  let chapter = await prisma.chapter.findFirst({
    where: { subjectId: subject.id, nameEn: "Algebra Basics" },
  });
  chapter ??= await prisma.chapter.create({
    data: {
      subjectId: subject.id,
      nameEn: "Algebra Basics",
      nameAr: "أساسيات الجبر",
      nameKu: "بنەماکانی جەبر",
      nameTr: "Cebir Temelleri",
    },
  });

  let lesson1 = await prisma.lesson.findFirst({
    where: { chapterId: chapter.id, sortOrder: 1 },
  });
  lesson1 ??= await prisma.lesson.create({
    data: {
      chapterId: chapter.id,
      nameEn: "Introduction to Algebra",
      nameAr: "مقدمة في الجبر",
      nameKu: "پێشەکی بۆ جەبر",
      nameTr: "Cebire Giriş",
      isFree: true,
      durationSec: 600,
      sortOrder: 1,
    },
  });

  let lesson2 = await prisma.lesson.findFirst({
    where: { chapterId: chapter.id, sortOrder: 2 },
  });
  lesson2 ??= await prisma.lesson.create({
    data: {
      chapterId: chapter.id,
      nameEn: "Linear Equations",
      nameAr: "المعادلات الخطية",
      nameKu: "هاوکێشە هێڵییەکان",
      nameTr: "Doğrusal Denklemler",
      isFree: false,
      durationSec: 900,
      sortOrder: 2,
    },
  });

  /* ── Packages ──────────────────────────────────── */
  let mathPackage = await prisma.subscriptionPackage.findFirst({
    where: { countryId: iraq.id, nameEn: "Mathematics — 1 Device" },
  });
  mathPackage ??= await prisma.subscriptionPackage.create({
    data: {
      countryId: iraq.id,
      type: "SINGLE_SUBJECT",
      nameEn: "Mathematics — 1 Device",
      nameAr: "الرياضيات — جهاز واحد",
      nameKu: "بیرکاری — ١ ئامێر",
      nameTr: "Matematik — 1 Cihaz",
      price: 50000,
      currency: "IQD",
      deviceLimit: 1,
      subjectId: subject.id,
    },
  });

  const stagePackage = await prisma.subscriptionPackage.findFirst({
    where: { countryId: iraq.id, type: "FULL_STAGE" },
  });
  if (!stagePackage) {
    await prisma.subscriptionPackage.create({
      data: {
        countryId: iraq.id,
        type: "FULL_STAGE",
        nameEn: "Full Secondary Stage",
        nameAr: "المرحلة الثانوية كاملة",
        nameKu: "تەواوی قۆناغی ناوەندی",
        nameTr: "Tam Ortaokul Paketi",
        price: 250000,
        currency: "IQD",
        deviceLimit: 1,
        stageId: stage.id,
      },
    });
  }

  /* ── Staff users ───────────────────────────────── */
  await prisma.user.upsert({
    where: { phone: "+9647000000001" },
    update: {},
    create: {
      phone: "+9647000000001",
      fullLegalName: "Super Admin",
      role: "SUPER_ADMIN",
      status: "APPROVED",
      locale: "EN",
      email: "admin@ulearn.app",
    },
  });

  const teacher = await prisma.user.upsert({
    where: { phone: "+9647000000002" },
    update: {},
    create: {
      phone: "+9647000000002",
      fullLegalName: "Ahmed Al-Rashid",
      role: "TEACHER",
      status: "APPROVED",
      locale: "AR",
      countryId: iraq.id,
      provinceId: baghdad?.id,
      teacherProfile: {
        create: {
          countryId: iraq.id,
          provinceId: baghdad?.id,
          bio: "Mathematics teacher with 12 years of experience.",
          specializations: ["Mathematics", "Physics"],
          subjects: { create: [{ subjectId: subject.id }] },
        },
      },
    },
  });

  /* ── Test students ─────────────────────────────── */
  const studentSpecs = [
    { phone: "+9647100000001", name: "Sara Hussein", gender: "FEMALE" as const, province: baghdad },
    { phone: "+9647100000002", name: "Omar Karim", gender: "MALE" as const, province: erbil },
    { phone: "+9647100000003", name: "Layla Ahmed", gender: "FEMALE" as const, province: baghdad },
    { phone: "+9647100000004", name: "Yusuf Hassan", gender: "MALE" as const, province: erbil },
    { phone: "+9647100000005", name: "Zainab Ali", gender: "FEMALE" as const, province: baghdad },
  ];

  const students = [];
  for (const spec of studentSpecs) {
    const student = await prisma.user.upsert({
      where: { phone: spec.phone },
      update: {},
      create: {
        phone: spec.phone,
        fullLegalName: spec.name,
        gender: spec.gender,
        parentPhone: "+9647200000000",
        role: "STUDENT",
        status: "APPROVED",
        locale: "AR",
        countryId: iraq.id,
        provinceId: spec.province?.id,
        lastActivityAt: new Date(),
        studentProfile: {
          create: {
            educationalStageId: stage.id,
            grade: "10",
            schoolUniversity: "Baghdad High School",
          },
        },
      },
    });
    students.push(student);
  }

  // One student pending approval (to test the approval flow)
  await prisma.user.upsert({
    where: { phone: "+9647100000009" },
    update: {},
    create: {
      phone: "+9647100000009",
      fullLegalName: "Hasan Jaafar",
      gender: "MALE",
      role: "STUDENT",
      status: "PENDING",
      locale: "AR",
      countryId: iraq.id,
      provinceId: baghdad?.id,
      studentProfile: {
        create: {
          educationalStageId: stage.id,
          grade: "11",
          schoolUniversity: "Erbil High School",
        },
      },
    },
  });

  // One certificate user
  const certUser = await prisma.user.upsert({
    where: { phone: "+9647100000010" },
    update: {},
    create: {
      phone: "+9647100000010",
      fullLegalName: "Noor Salim",
      gender: "FEMALE",
      role: "CERTIFICATE_USER",
      status: "APPROVED",
      locale: "EN",
      countryId: iraq.id,
      provinceId: baghdad?.id,
      certificateProfile: {
        create: {
          educationalQualification: "Bachelor of Engineering",
          specialization: "Civil Engineering",
          occupation: "Site Engineer",
        },
      },
    },
  });

  /* ── Subscriptions for the first two students ──── */
  const expiry = new Date(new Date().getFullYear() + 1, 6, 15);
  for (const student of students.slice(0, 2)) {
    const existing = await prisma.subscription.findFirst({
      where: { userId: student.id, packageId: mathPackage.id },
    });
    if (!existing) {
      await prisma.subscription.create({
        data: {
          userId: student.id,
          packageId: mathPackage.id,
          status: "ACTIVE",
          startsAt: new Date(),
          expiresAt: expiry,
          deviceLimit: 1,
          activatedBy: "SEED",
        },
      });
    }
  }

  /* ── Video progress & daily activity ───────────── */
  const progressSpecs = [
    { user: students[0], lesson: lesson1, pct: 100, pos: 600 },
    { user: students[0], lesson: lesson2, pct: 45, pos: 405 },
    { user: students[1], lesson: lesson1, pct: 80, pos: 480 },
    { user: students[2], lesson: lesson1, pct: 30, pos: 180 },
  ];
  for (const p of progressSpecs) {
    await prisma.videoProgress.upsert({
      where: { userId_lessonId: { userId: p.user.id, lessonId: p.lesson.id } },
      update: {},
      create: {
        userId: p.user.id,
        lessonId: p.lesson.id,
        positionSec: p.pos,
        durationSec: p.lesson.durationSec,
        completionPct: p.pct,
        isCompleted: p.pct >= 90,
        totalWatchSec: p.pos,
        lastWatchedAt: new Date(),
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.dailyActivity.upsert({
      where: { userId_date: { userId: p.user.id, date: today } },
      update: {},
      create: {
        userId: p.user.id,
        date: today,
        watchTimeSec: p.pos,
        lessonsDone: p.pct >= 90 ? 1 : 0,
      },
    });
  }

  /* ── Quiz with questions + attempts ────────────── */
  let quiz = await prisma.quiz.findFirst({
    where: { lessonId: lesson1.id, titleEn: "Algebra Basics Quiz" },
  });
  quiz ??= await prisma.quiz.create({
    data: {
      type: "LESSON",
      lessonId: lesson1.id,
      titleEn: "Algebra Basics Quiz",
      titleAr: "اختبار أساسيات الجبر",
      titleKu: "تاقیکردنەوەی بنەماکانی جەبر",
      titleTr: "Cebir Temelleri Sınavı",
      timeLimitSec: 300,
      maxAttempts: 3,
      passPercentage: 60,
      questions: {
        create: [
          {
            textEn: "What is the value of x in: x + 5 = 12?",
            textAr: "ما قيمة x في: x + 5 = 12؟",
            textKu: "نرخی x چەندە لە: x + 5 = 12؟",
            textTr: "x + 5 = 12 denkleminde x kaçtır?",
            options: { a: "5", b: "7", c: "12", d: "17" },
            correctKey: "b",
            points: 1,
            sortOrder: 0,
          },
          {
            textEn: "Simplify: 3x + 2x",
            textAr: "بسّط: 3x + 2x",
            textKu: "سادەی بکەرەوە: 3x + 2x",
            textTr: "Sadeleştir: 3x + 2x",
            options: { a: "5x", b: "6x", c: "5x²", d: "x" },
            correctKey: "a",
            points: 1,
            sortOrder: 1,
          },
          {
            textEn: "Which of these is a linear equation?",
            textAr: "أي مما يلي معادلة خطية؟",
            textKu: "کامیان هاوکێشەی هێڵییە؟",
            textTr: "Hangisi doğrusal bir denklemdir?",
            options: { a: "x² = 4", b: "y = 2x + 1", c: "x³ + 1 = 0", d: "1/x = 2" },
            correctKey: "b",
            points: 1,
            sortOrder: 2,
          },
        ],
      },
    },
  });

  const attemptExists = await prisma.quizAttempt.findFirst({
    where: { quizId: quiz.id, userId: students[0].id },
  });
  if (!attemptExists) {
    await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: students[0].id,
        score: 3,
        maxScore: 3,
        percentage: 100,
        passed: true,
        answers: { seeded: true },
        completedAt: new Date(),
        timeSpentSec: 180,
      },
    });
    await prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: students[1].id,
        score: 1,
        maxScore: 3,
        percentage: 33.3,
        passed: false,
        answers: { seeded: true },
        completedAt: new Date(),
        timeSpentSec: 240,
      },
    });
  }

  /* ── Sample Q&A ────────────────────────────────── */
  const questionExists = await prisma.lessonQuestion.findFirst({
    where: { lessonId: lesson1.id, studentId: students[2].id },
  });
  if (!questionExists) {
    await prisma.lessonQuestion.create({
      data: {
        lessonId: lesson1.id,
        studentId: students[2].id,
        body: "Can you explain the difference between an expression and an equation?",
        answers: {
          create: {
            teacherId: teacher.id,
            body: "An expression has no equals sign (like 3x + 2), while an equation states two expressions are equal (like 3x + 2 = 8).",
          },
        },
        isResolved: true,
      },
    });
    await prisma.lessonQuestion.create({
      data: {
        lessonId: lesson2.id,
        studentId: students[0].id,
        body: "How do I solve equations with variables on both sides?",
      },
    });
  }

  /* ── Activation codes ──────────────────────────── */
  const codeCount = await prisma.activationCode.count();
  if (codeCount === 0) {
    for (let i = 0; i < 3; i++) {
      const code = `TEST-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await prisma.activationCode.create({
        data: {
          code,
          packageId: mathPackage.id,
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  /* ── Welcome notifications ─────────────────────── */
  const notifCount = await prisma.userNotification.count();
  if (notifCount === 0) {
    for (const student of [...students, certUser]) {
      await prisma.userNotification.create({
        data: {
          userId: student.id,
          title: student.locale === "AR" ? "مرحباً بك في يو ليرن" : "Welcome to U Learn",
          body:
            student.locale === "AR"
              ? "حسابك جاهز. ابدأ التعلم الآن!"
              : "Your account is ready. Start learning now!",
        },
      });
    }
  }

  /* ── System settings ───────────────────────────── */
  const settings: Array<{ key: string; value: string | number | boolean }> = [
    { key: "global_subscription_expiry", value: new Date(new Date().getFullYear(), 6, 15).toISOString() },
    { key: "exclude_certificate_from_global_expiry", value: true },
    { key: "inactivity_days", value: 30 },
  ];
  for (const s of settings) {
    const existing = await prisma.systemSetting.findFirst({
      where: { key: s.key, countryId: null },
    });
    if (!existing) {
      await prisma.systemSetting.create({ data: { key: s.key, value: s.value } });
    }
  }

  console.log("Seed complete.");
  console.log("Super Admin:      +9647000000001");
  console.log("Teacher:          +9647000000002 (Ahmed Al-Rashid)");
  console.log("Students:         +9647100000001 … +9647100000005 (approved)");
  console.log("Pending student:  +9647100000009 (Hasan Jaafar)");
  console.log("Certificate user: +9647100000010 (Noor Salim)");
  console.log("First two students have active Mathematics subscriptions.");
  const codes = await prisma.activationCode.findMany({ where: { usedAt: null }, take: 3 });
  console.log("Unused activation codes:", codes.map((c) => c.code).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
