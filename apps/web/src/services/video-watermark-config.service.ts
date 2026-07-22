import { prisma } from "@/lib/prisma";

export type VideoWatermarkConfig = {
  brandText: string;
  opacity: number;
  fontSize: number;
  includeCourseName: boolean;
  includeInstructorName: boolean;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
};

export const DEFAULT_WATERMARK_CONFIG: VideoWatermarkConfig = {
  brandText: "U Learn",
  opacity: 0.45,
  fontSize: 28,
  includeCourseName: true,
  includeInstructorName: true,
  position: "bottom-right",
};

const SETTING_KEY = "video.watermark.global";

export class VideoWatermarkConfigService {
  static async get(): Promise<VideoWatermarkConfig> {
    const row = await prisma.systemSetting.findFirst({
      where: { countryId: null, key: SETTING_KEY },
    });
    if (!row?.value || typeof row.value !== "object") return DEFAULT_WATERMARK_CONFIG;
    return { ...DEFAULT_WATERMARK_CONFIG, ...(row.value as VideoWatermarkConfig) };
  }

  static async update(config: VideoWatermarkConfig, updatedBy: string) {
    const existing = await prisma.systemSetting.findFirst({
      where: { countryId: null, key: SETTING_KEY },
    });
    if (existing) {
      return prisma.systemSetting.update({
        where: { id: existing.id },
        data: { value: config, updatedBy },
      });
    }
    return prisma.systemSetting.create({
      data: { key: SETTING_KEY, value: config, updatedBy },
    });
  }

  static buildUploadWatermarkText(
    config: VideoWatermarkConfig,
    extras: { courseName?: string; instructorName?: string }
  ) {
    const parts = [config.brandText];
    if (config.includeCourseName && extras.courseName) parts.push(extras.courseName);
    if (config.includeInstructorName && extras.instructorName) parts.push(extras.instructorName);
    return parts.join(" · ").slice(0, 120);
  }
}
