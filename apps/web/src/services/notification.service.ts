import { prisma } from "@/lib/prisma";
import type { Locale, NotificationChannel, NotificationTarget, Prisma } from "@prisma/client";
import { Resend } from "resend";

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

export class NotificationService {
  static async notifyUser(userId: string, message: LocalizedMessage, data?: Record<string, unknown>) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const { title, body } = pickLocale(message, user.locale);

    await prisma.userNotification.create({
      data: {
        userId,
        title,
        body,
        data: (data as Prisma.InputJsonValue) ?? undefined,
      },
    });

    if (user.fcmTokens.length > 0) {
      await this.sendPush(user.fcmTokens, title, body, data);
    }

    if (user.email) {
      await this.sendEmail(user.email, title, body);
    }
  }

  static async broadcast(params: {
    message: LocalizedMessage;
    channels: NotificationChannel[];
    target: NotificationTarget;
    countryId?: string;
    provinceId?: string;
    userIds?: string[];
    createdById?: string;
  }) {
    const notification = await prisma.notification.create({
      data: {
        ...params.message,
        channels: params.channels,
        target: params.target,
        countryId: params.countryId,
        provinceId: params.provinceId,
        userIds: params.userIds ?? [],
        createdById: params.createdById,
        sentAt: new Date(),
      },
    });

    const users = await this.resolveTargets(params);

    for (const user of users) {
      const { title, body } = pickLocale(params.message, user.locale);

      if (params.channels.includes("IN_APP")) {
        await prisma.userNotification.create({
          data: {
            userId: user.id,
            notificationId: notification.id,
            title,
            body,
          },
        });
      }

      if (params.channels.includes("PUSH") && user.fcmTokens.length > 0) {
        await this.sendPush(user.fcmTokens, title, body);
      }

      if (params.channels.includes("EMAIL") && user.email) {
        await this.sendEmail(user.email, title, body);
      }
    }

    return notification;
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
    const serverKey = process.env.FCM_SERVER_KEY;
    if (!serverKey) {
      if (process.env.NODE_ENV === "development") {
        console.info(`[DEV] FCM push: ${title} → ${tokens.length} devices`);
      }
      return;
    }

    await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${serverKey}`,
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: { title, body },
        data: data ?? {},
      }),
    });
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
      html: `<div style="font-family:sans-serif;padding:24px"><h2>${subject}</h2><p>${html}</p></div>`,
    });
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
