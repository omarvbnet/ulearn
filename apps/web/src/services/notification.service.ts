import { prisma } from "@/lib/prisma";
import type { Locale, NotificationChannel, NotificationTarget, Prisma } from "@prisma/client";
import { Resend } from "resend";
import { isFcmConfigured, sendFcmPush } from "@/services/fcm.service";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

type LocalizedMessage = {
  titleEn: string;
  titleAr: string;
  titleKu: string;
  titleTr: string;
  bodyEn: string;
  bodyAr: string;
  bodyKu: string;
  bodyTr: string;
};

function pickLocale(msg: LocalizedMessage, locale: Locale) {
  const map = {
    EN: { title: msg.titleEn, body: msg.bodyEn },
    AR: { title: msg.titleAr, body: msg.bodyAr },
    KU: { title: msg.titleKu, body: msg.bodyKu },
    TR: { title: msg.titleTr, body: msg.bodyTr },
  };
  return map[locale] ?? map.EN;
}

/** UI historically used "ALL"; Prisma enum is EVERYONE. */
function normalizeNotificationTarget(
  raw: NotificationTarget | string
): NotificationTarget {
  const value = String(raw ?? "").toUpperCase();
  if (value === "ALL" || value === "EVERYONE") return "EVERYONE";
  if (value === "COUNTRY" || value === "PROVINCE" || value === "USERS") {
    return value;
  }
  throw new Error(`Invalid notification target: ${raw}`);
}

/** Drop undefined/null so Prisma JSON / Accelerate don't reject the payload. */
function sanitizeLinkData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

export class NotificationService {
  static async notifyUser(userId: string, message: LocalizedMessage, data?: Record<string, unknown>) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const { title, body } = pickLocale(message, user.locale);
    const linkData = data ? sanitizeLinkData(data) : undefined;

    await prisma.userNotification.create({
      data: {
        userId,
        title,
        body,
        ...(linkData && Object.keys(linkData).length
          ? { data: linkData as Prisma.InputJsonValue }
          : {}),
      },
    });

    if (user.fcmTokens.length > 0) {
      await this.sendPush(user.fcmTokens, title, body, linkData);
    }

    if (user.email) {
      await this.sendEmail(
        user.email,
        title,
        `<div style="font-family:sans-serif;padding:24px"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`
      );
    }
  }

  static async broadcast(params: {
    message: LocalizedMessage;
    channels: NotificationChannel[];
    target: NotificationTarget | string;
    countryId?: string;
    provinceId?: string;
    userIds?: string[];
    createdById?: string;
    /** Deep-link payload for mobile (ads, course, etc.). */
    data?: Record<string, unknown>;
  }) {
    const target = normalizeNotificationTarget(params.target);
    const notification = await prisma.notification.create({
      data: {
        ...params.message,
        channels: params.channels,
        target,
        ...(params.countryId ? { countryId: params.countryId } : {}),
        ...(params.provinceId ? { provinceId: params.provinceId } : {}),
        userIds: params.userIds ?? [],
        ...(params.createdById ? { createdById: params.createdById } : {}),
        sentAt: new Date(),
      },
    });

    const users = await this.resolveTargets({
      ...params,
      target,
    });
    const linkData = sanitizeLinkData(
      params.data ?? {
        type: "admin",
        screen: "ads",
      }
    );

    // Batch in-app rows to avoid long request times / Accelerate round-trips.
    if (params.channels.includes("IN_APP") && users.length > 0) {
      const rows = users.map((user) => {
        const { title, body } = pickLocale(params.message, user.locale);
        return {
          userId: user.id,
          notificationId: notification.id,
          title,
          body,
          data: linkData as Prisma.InputJsonValue,
        };
      });
      const chunkSize = 200;
      for (let i = 0; i < rows.length; i += chunkSize) {
        await prisma.userNotification.createMany({
          data: rows.slice(i, i + chunkSize),
        });
      }
    }

    for (const user of users) {
      const { title, body } = pickLocale(params.message, user.locale);

      if (params.channels.includes("PUSH") && user.fcmTokens.length > 0) {
        await this.sendPush(user.fcmTokens, title, body, linkData).catch((err) => {
          console.error("[NotificationService] push failed", user.id, err);
        });
      }

      if (params.channels.includes("EMAIL") && user.email) {
        await this.sendEmail(
          user.email,
          title,
          `<div style="font-family:sans-serif;padding:24px"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>`
        ).catch((err) => {
          console.error("[NotificationService] email failed", user.id, err);
        });
      }
    }

    const pushEnabled = params.channels.includes("PUSH");
    const usersWithTokens = users.filter((u) => u.fcmTokens.length > 0).length;
    const tokenCount = users.reduce((n, u) => n + u.fcmTokens.length, 0);
    const push = {
      requested: pushEnabled,
      fcmConfigured: isFcmConfigured(),
      recipients: users.length,
      usersWithTokens,
      tokenCount,
    };
    if (pushEnabled && !push.fcmConfigured) {
      console.error("[NotificationService] PUSH selected but Firebase service account is not configured");
    } else if (pushEnabled && tokenCount === 0) {
      console.warn(
        `[NotificationService] PUSH selected but no fcmTokens on ${users.length} recipient(s)`
      );
    }

    return { notification, push };
  }

  private static async resolveTargets(params: {
    target: NotificationTarget;
    countryId?: string;
    provinceId?: string;
    userIds?: string[];
  }) {
    if (params.target === "USERS" && params.userIds?.length) {
      return prisma.user.findMany({
        where: { id: { in: params.userIds }, deletedAt: null },
      });
    }

    if (params.target === "PROVINCE" && params.provinceId) {
      return prisma.user.findMany({
        where: { provinceId: params.provinceId, deletedAt: null, status: "APPROVED" },
      });
    }

    if (params.target === "COUNTRY" && params.countryId) {
      return prisma.user.findMany({
        where: { countryId: params.countryId, deletedAt: null, status: "APPROVED" },
      });
    }

    return prisma.user.findMany({
      where: { deletedAt: null, status: "APPROVED" },
    });
  }

  private static async sendPush(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, unknown>
  ) {
    const { invalidTokens } = await sendFcmPush(tokens, title, body, data);
    if (invalidTokens.length === 0) return;

    // Drop dead FCM tokens so future broadcasts skip them.
    for (const bad of invalidTokens) {
      try {
        const users = await prisma.user.findMany({
          where: { fcmTokens: { has: bad } },
          select: { id: true, fcmTokens: true },
        });
        for (const user of users) {
          await prisma.user.update({
            where: { id: user.id },
            data: { fcmTokens: user.fcmTokens.filter((t) => t !== bad) },
          });
        }
      } catch (err) {
        console.error("[FCM] prune token failed", err);
      }
    }
  }

  private static async sendEmail(to: string, subject: string, html: string) {
    if (!resend) {
      if (process.env.NODE_ENV === "development") {
        console.info(`[DEV] Email to ${to}: ${subject}`);
      }
      return;
    }

    await resend.emails.send({
      from: process.env.EMAIL_FROM || "U Learn <noreply@ulearn.app>",
      to,
      subject,
      html,
    });
  }

  /** Branded quiz result email to a student's parent. */
  static async notifyParentQuizResult(params: {
    userId: string;
    quizTitle: string;
    percentage: number;
    passed: boolean;
    passPercentage: number;
    timeSpentSec?: number;
    score: number;
    maxScore: number;
  }) {
    const student = await prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        fullLegalName: true,
        parentEmail: true,
        locale: true,
      },
    });
    if (!student?.parentEmail) return;

    const locale = student.locale;
    const name = student.fullLegalName ?? "Student";
    const pct = Math.round(params.percentage);
    const time = formatQuizTime(params.timeSpentSec);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ulearn.usmart-iot.com";
    const logoUrl = `${appUrl}/logo.svg`;

    const copy = quizParentCopy(locale, {
      name,
      quizTitle: params.quizTitle,
      pct,
      passed: params.passed,
      passPct: Math.round(params.passPercentage),
      time,
      score: params.score,
      maxScore: params.maxScore,
    });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#050510;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050510;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#0c0c1a;border-radius:16px;border:1px solid #1a1a35;overflow:hidden;">
        <tr>
          <td style="padding:28px 28px 16px;text-align:center;background:linear-gradient(135deg,#a020f0,#00e5ff);">
            <img src="${logoUrl}" alt="U Learn" width="72" height="72" style="border-radius:14px;margin-bottom:12px;" />
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">U Learn</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <h2 style="margin:0 0 12px;color:#e8f4ff;font-size:18px;">${copy.subject}</h2>
            <p style="margin:0 0 20px;color:#8b9bb4;line-height:1.6;font-size:15px;">${copy.intro}</p>
            <table width="100%" style="background:#050510;border-radius:12px;border:1px solid #1a1a35;margin-bottom:20px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 8px;color:#8b9bb4;font-size:13px;">${copy.quizLabel}</p>
                  <p style="margin:0 0 16px;color:#e8f4ff;font-size:16px;font-weight:600;">${escapeHtml(params.quizTitle)}</p>
                  <p style="margin:0 0 4px;color:#8b9bb4;font-size:13px;">${copy.scoreLabel}</p>
                  <p style="margin:0 0 16px;color:${params.passed ? "#38ef7d" : "#ff6b6b"};font-size:28px;font-weight:800;">${pct}%</p>
                  <p style="margin:0 0 4px;color:#8b9bb4;font-size:13px;">${copy.timeLabel}</p>
                  <p style="margin:0;color:#e8f4ff;font-size:15px;">${time}</p>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#e8f4ff;line-height:1.65;font-size:15px;">${copy.message}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 24px;text-align:center;color:#8b9bb4;font-size:12px;">
            ${copy.footer}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await this.sendEmail(student.parentEmail, copy.subject, html);
  }

  static async getUserNotifications(userId: string, limit = 50) {
    return prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  static async markRead(notificationId: string, userId: string) {
    return prisma.userNotification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatQuizTime(sec?: number) {
  if (sec == null || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function quizParentCopy(
  locale: Locale,
  p: {
    name: string;
    quizTitle: string;
    pct: number;
    passed: boolean;
    passPct: number;
    time: string;
    score: number;
    maxScore: number;
  }
) {
  const en = {
    subject: p.passed ? "Great news — quiz passed!" : "Quiz result — room to improve",
    intro: `${p.name} completed a quiz on U Learn.`,
    quizLabel: "Quiz",
    scoreLabel: "Score",
    timeLabel: "Time taken",
    message: p.passed
      ? `Congratulations! ${p.name} scored ${p.pct}% (pass mark: ${p.passPct}%). Excellent work — encourage them to keep learning and exploring more lessons.`
      : `${p.name} scored ${p.pct}% (pass mark: ${p.passPct}%). Please encourage them to review the lesson material and try again. Every attempt builds stronger understanding.`,
    footer: "U Learn — empowering students to learn smarter.",
  };
  const ar = {
    subject: p.passed ? "أخبار رائعة — نجح في الاختبار!" : "نتيجة الاختبار — فرصة للتحسين",
    intro: `أكمل ${p.name} اختباراً على منصة U Learn.`,
    quizLabel: "الاختبار",
    scoreLabel: "الدرجة",
    timeLabel: "الوقت المستغرق",
    message: p.passed
      ? `تهانينا! حصل ${p.name} على ${p.pct}% (درجة النجاح: ${p.passPct}%). عمل ممتاز — شجّعوه على مواصلة التعلم.`
      : `حصل ${p.name} على ${p.pct}% (درجة النجاح: ${p.passPct}%). يُرجى تشجيعه على مراجعة الدروس والمحاولة مرة أخرى.`,
    footer: "U Learn — منصة تعليمية ذكية.",
  };
  const ku = {
    subject: p.passed ? "هەواڵی خۆش — تاقیکردنەوە سەرکەوت!" : "ئەنجامی تاقیکردنەوە — دەرفەتی باشترکردن",
    intro: `${p.name} تاقیکردنەوەیەکی تەواو کرد لە U Learn.`,
    quizLabel: "تاقیکردنەوە",
    scoreLabel: "نمرە",
    timeLabel: "کاتی بەسەربردراو",
    message: p.passed
      ? `پیرۆزە! ${p.name} ${p.pct}% وەرگرت (نمرەی سەرکەوتن: ${p.passPct}%). کارێکی نایاب — هانی بدەن بەردەوام بێت لە فێربوون.`
      : `${p.name} ${p.pct}% وەرگرت (نمرەی سەرکەوتن: ${p.passPct}%). تکایە هانی بدەن وانەکان بپشکنێتەوە و دووبارە هەوڵ بدات.`,
    footer: "U Learn — پلاتفۆرمی فێربوونی زیرەک.",
  };
  const tr = {
    subject: p.passed ? "Harika haber — sınav geçildi!" : "Sınav sonucu — gelişim fırsatı",
    intro: `${p.name}, U Learn'de bir sınavı tamamladı.`,
    quizLabel: "Sınav",
    scoreLabel: "Puan",
    timeLabel: "Süre",
    message: p.passed
      ? `Tebrikler! ${p.name} %${p.pct} aldı (geçme notu: %${p.passPct}). Harika bir başarı — öğrenmeye devam etmesini teşvik edin.`
      : `${p.name} %${p.pct} aldı (geçme notu: %${p.passPct}). Dersleri tekrar gözden geçirmesini ve yeniden denemesini teşvik edin.`,
    footer: "U Learn — akıllı öğrenme platformu.",
  };
  const map = { EN: en, AR: ar, KU: ku, TR: tr };
  return map[locale] ?? en;
}
