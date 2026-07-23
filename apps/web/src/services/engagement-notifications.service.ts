import { NotificationService } from "@/services/notification.service";

export async function notifyTeacherCourseLike(params: {
  teacherUserId: string;
  courseTitle: string;
  likerName: string;
  courseId: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "New course like",
      titleAr: "إعجاب جديد بالدورة",
      titleKu: "لایکی نوێ بۆ کۆرس",
      titleTr: "Yeni kurs beğenisi",
      bodyEn: `${params.likerName} liked your course "${params.courseTitle}".`,
      bodyAr: `${params.likerName} أعجب بدورتك "${params.courseTitle}".`,
      bodyKu: `${params.likerName} لە کۆرسەکەت "${params.courseTitle}" حەزی کرد.`,
      bodyTr: `${params.likerName}, "${params.courseTitle}" kursunuzu beğendi.`,
    },
    { type: "like", courseId: params.courseId, screen: "course" }
  ).catch(() => {});
}

export async function notifyTeacherVideoLike(params: {
  teacherUserId: string;
  lessonTitle: string;
  likerName: string;
  courseId?: string;
  lessonId?: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "New video like",
      titleAr: "إعجاب جديد بالفيديو",
      titleKu: "لایکی نوێ بۆ ڤیدیۆ",
      titleTr: "Yeni video beğenisi",
      bodyEn: `${params.likerName} liked your video "${params.lessonTitle}".`,
      bodyAr: `${params.likerName} أعجب بفيديو "${params.lessonTitle}".`,
      bodyKu: `${params.likerName} لە ڤیدیۆی "${params.lessonTitle}" حەزی کرد.`,
      bodyTr: `${params.likerName}, "${params.lessonTitle}" videosunu beğendi.`,
    },
    {
      type: "like",
      courseId: params.courseId,
      lessonId: params.lessonId,
      screen: "course",
    }
  ).catch(() => {});
}

export async function notifyTeacherShortVideoLike(params: {
  teacherUserId: string;
  videoTitle: string;
  likerName: string;
  shortVideoId?: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "New short video like",
      titleAr: "إعجاب جديد بالفيديو القصير",
      titleKu: "لایکی نوێ بۆ ڤیدیۆی کورت",
      titleTr: "Yeni kısa video beğenisi",
      bodyEn: `${params.likerName} liked your short video "${params.videoTitle}".`,
      bodyAr: `${params.likerName} أعجب بفيديوك القصير "${params.videoTitle}".`,
      bodyKu: `${params.likerName} لە ڤیدیۆی کورت "${params.videoTitle}" حەزی کرد.`,
      bodyTr: `${params.likerName}, "${params.videoTitle}" kısa videonuzu beğendi.`,
    },
    {
      type: "like",
      shortVideoId: params.shortVideoId,
      screen: "reels",
    }
  ).catch(() => {});
}

export async function notifyTeacherShortVideoSave(params: {
  teacherUserId: string;
  videoTitle: string;
  saverName: string;
  shortVideoId?: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "Someone saved your reel",
      titleAr: "شخص ما حفظ فيديوك القصير",
      titleKu: "کەسێک ڤیدیۆکەتی پاشەکەوت کرد",
      titleTr: "Birisi reelinizi kaydetti",
      bodyEn: `${params.saverName} saved your short video "${params.videoTitle}".`,
      bodyAr: `${params.saverName} حفظ فيديوك القصير "${params.videoTitle}".`,
      bodyKu: `${params.saverName} ڤیدیۆی کورت "${params.videoTitle}" پاشەکەوت کرد.`,
      bodyTr: `${params.saverName}, "${params.videoTitle}" kısa videonuzu kaydetti.`,
    },
    {
      type: "save",
      shortVideoId: params.shortVideoId,
      screen: "reels",
    }
  ).catch(() => {});
}

export async function notifyTeacherShortVideoComment(params: {
  teacherUserId: string;
  videoTitle: string;
  commenterName: string;
  comment: string;
  shortVideoId?: string;
  commentId?: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "New comment on your reel",
      titleAr: "تعليق جديد على فيديوك",
      titleKu: "سەرنجی نوێ لە ڤیدیۆکەت",
      titleTr: "Reelinize yeni yorum",
      bodyEn: `${params.commenterName} on "${params.videoTitle}": ${params.comment.slice(0, 120)}`,
      bodyAr: `${params.commenterName} على "${params.videoTitle}": ${params.comment.slice(0, 120)}`,
      bodyKu: `${params.commenterName} لە "${params.videoTitle}": ${params.comment.slice(0, 120)}`,
      bodyTr: `${params.commenterName}, "${params.videoTitle}": ${params.comment.slice(0, 120)}`,
    },
    {
      type: "comment",
      shortVideoId: params.shortVideoId,
      commentId: params.commentId,
      screen: "comments",
    }
  ).catch(() => {});
}

export async function notifyTeacherNewQuestion(params: {
  teacherUserId: string;
  lessonTitle: string;
  studentName: string;
  question: string;
  courseId?: string;
  lessonId?: string;
  questionId?: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "New student question",
      titleAr: "سؤال جديد من طالب",
      titleKu: "پرسیاری نوێ لە خوێندکار",
      titleTr: "Yeni öğrenci sorusu",
      bodyEn: `${params.studentName} asked on "${params.lessonTitle}": ${params.question.slice(0, 120)}`,
      bodyAr: `${params.studentName} سأل في "${params.lessonTitle}": ${params.question.slice(0, 120)}`,
      bodyKu: `${params.studentName} لە "${params.lessonTitle}" پرسیار کرد: ${params.question.slice(0, 120)}`,
      bodyTr: `${params.studentName}, "${params.lessonTitle}" için sordu: ${params.question.slice(0, 120)}`,
    },
    {
      type: "question",
      courseId: params.courseId,
      lessonId: params.lessonId,
      questionId: params.questionId,
      screen: "course",
    }
  ).catch(() => {});
}

export async function notifyStudentAnswer(params: {
  studentUserId: string;
  lessonTitle: string;
  answererName: string;
  courseId?: string;
  lessonId?: string;
  questionId?: string;
  answerId?: string;
}) {
  await NotificationService.notifyUser(
    params.studentUserId,
    {
      titleEn: "Your question was answered",
      titleAr: "تمت الإجابة على سؤالك",
      titleKu: "پرسیارەکەت وەڵام درایەوە",
      titleTr: "Sorunuz yanıtlandı",
      bodyEn: `${params.answererName} replied on "${params.lessonTitle}".`,
      bodyAr: `${params.answererName} أجاب على "${params.lessonTitle}".`,
      bodyKu: `${params.answererName} وەڵامی "${params.lessonTitle}" دایەوە.`,
      bodyTr: `${params.answererName}, "${params.lessonTitle}" sorusuna yanıt verdi.`,
    },
    {
      type: "answer",
      courseId: params.courseId,
      lessonId: params.lessonId,
      questionId: params.questionId,
      answerId: params.answerId,
      screen: "course",
    }
  ).catch(() => {});
}

/** Teacher gets notified when a student successfully subscribes / purchases. */
export async function notifyTeacherNewSubscription(params: {
  teacherUserId: string;
  studentName: string;
  courseTitle: string;
  courseId: string;
}) {
  await NotificationService.notifyUser(
    params.teacherUserId,
    {
      titleEn: "New course subscription",
      titleAr: "اشتراك جديد في الدورة",
      titleKu: "بەشداری نوێ لە کۆرس",
      titleTr: "Yeni kurs aboneliği",
      bodyEn: `${params.studentName} subscribed to "${params.courseTitle}".`,
      bodyAr: `${params.studentName} اشترك في "${params.courseTitle}".`,
      bodyKu: `${params.studentName} بەشداری "${params.courseTitle}" بوو.`,
      bodyTr: `${params.studentName}, "${params.courseTitle}" kursuna abone oldu.`,
    },
    {
      type: "subscription",
      courseId: params.courseId,
      screen: "course",
    }
  ).catch(() => {});
}

export async function notifySubscribersLessonUpdated(params: {
  userIds: string[];
  courseTitle: string;
  lessonTitle: string;
  courseId?: string;
  lessonId?: string;
}) {
  for (const userId of params.userIds) {
    await NotificationService.notifyUser(
      userId,
      {
        titleEn: "Course video updated",
        titleAr: "تم تحديث فيديو الدورة",
        titleKu: "ڤیدیۆی کۆرس نوێکرایەوە",
        titleTr: "Kurs videosu güncellendi",
        bodyEn: `"${params.lessonTitle}" in "${params.courseTitle}" has new content.`,
        bodyAr: `"${params.lessonTitle}" في "${params.courseTitle}" تم تحديثه.`,
        bodyKu: `"${params.lessonTitle}" لە "${params.courseTitle}" نوێکرایەوە.`,
        bodyTr: `"${params.courseTitle}" içindeki "${params.lessonTitle}" güncellendi.`,
      },
      {
        type: "course",
        courseId: params.courseId,
        lessonId: params.lessonId,
        screen: "course",
      }
    ).catch(() => {});
  }
}

/** New lesson(s) published on a course the student already purchased. */
export async function notifySubscribersNewLesson(params: {
  userIds: string[];
  courseTitle: string;
  lessonTitle: string;
  courseId: string;
  lessonId?: string;
  extraCount?: number;
}) {
  const extra = params.extraCount && params.extraCount > 0 ? params.extraCount : 0;
  const moreEn = extra > 0 ? ` (+${extra} more)` : "";
  const moreAr = extra > 0 ? ` (+${extra} أخرى)` : "";
  const moreKu = extra > 0 ? ` (+${extra}ی تر)` : "";
  const moreTr = extra > 0 ? ` (+${extra} daha)` : "";

  for (const userId of params.userIds) {
    await NotificationService.notifyUser(
      userId,
      {
        titleEn: "New lesson available",
        titleAr: "درس جديد متاح",
        titleKu: "وانەی نوێ بەردەستە",
        titleTr: "Yeni ders hazır",
        bodyEn: `"${params.lessonTitle}"${moreEn} was added to "${params.courseTitle}".`,
        bodyAr: `تمت إضافة "${params.lessonTitle}"${moreAr} إلى "${params.courseTitle}".`,
        bodyKu: `"${params.lessonTitle}"${moreKu} زیادکرا بۆ "${params.courseTitle}".`,
        bodyTr: `"${params.lessonTitle}"${moreTr}, "${params.courseTitle}" kursuna eklendi.`,
      },
      {
        type: "lesson",
        courseId: params.courseId,
        lessonId: params.lessonId,
        screen: "course",
      }
    ).catch(() => {});
  }
}

/** Teacher published a brand-new course (admin approved) — notify fans of their other courses. */
export async function notifySubscribersNewCourse(params: {
  userIds: string[];
  courseTitle: string;
  courseId: string;
  teacherName: string;
}) {
  for (const userId of params.userIds) {
    await NotificationService.notifyUser(
      userId,
      {
        titleEn: "New course from your teacher",
        titleAr: "دورة جديدة من معلمك",
        titleKu: "کۆرسی نوێ لە مامۆستاکەت",
        titleTr: "Öğretmeninizden yeni kurs",
        bodyEn: `${params.teacherName} published "${params.courseTitle}". Tap to explore.`,
        bodyAr: `${params.teacherName} نشر "${params.courseTitle}". اضغط للاستكشاف.`,
        bodyKu: `${params.teacherName} "${params.courseTitle}" بڵاوکردەوە. دەستی پێ بکە.`,
        bodyTr: `${params.teacherName}, "${params.courseTitle}" yayınladı. Keşfetmek için dokunun.`,
      },
      {
        type: "course",
        courseId: params.courseId,
        screen: "course",
      }
    ).catch(() => {});
  }
}
