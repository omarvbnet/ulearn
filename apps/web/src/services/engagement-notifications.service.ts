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
    { type: "course", courseId: params.courseId, screen: "course" }
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
      type: "course",
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
      type: "reel",
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
