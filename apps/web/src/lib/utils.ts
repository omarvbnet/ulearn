import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateOtp(length = 6): string {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

export function generateActivationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateCertificateNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `UL-${year}-${rand}`;
}

export function generateVerificationCode(): string {
  return Math.random().toString(36).substring(2, 14).toUpperCase();
}

export function getLocalizedField<T extends Record<string, unknown>>(
  entity: T,
  field: string,
  locale: string
): string {
  const key = `${field}${locale.charAt(0).toUpperCase()}${locale.slice(1).toLowerCase()}` as keyof T;
  const fallback = `${field}En` as keyof T;
  return (entity[key] as string) || (entity[fallback] as string) || "";
}

export function isRtl(locale: string): boolean {
  return locale === "ar" || locale === "ku";
}

export function defaultSubscriptionExpiry(year?: number): Date {
  const y = year ?? new Date().getFullYear();
  const now = new Date();
  const expiryYear = now > new Date(y, 6, 15) ? y + 1 : y;
  return new Date(expiryYear, 6, 15, 23, 59, 59);
}
