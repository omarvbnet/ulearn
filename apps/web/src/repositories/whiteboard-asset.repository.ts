import type { Prisma, VideoProcessingStatus, WhiteboardTheme } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class WhiteboardAssetRepository {
  create(data: Prisma.WhiteboardAssetCreateInput) {
    return prisma.whiteboardAsset.create({ data });
  }

  findById(id: string) {
    return prisma.whiteboardAsset.findUnique({
      where: { id },
      include: { courseLesson: { include: { course: true } } },
    });
  }

  update(id: string, data: Prisma.WhiteboardAssetUpdateInput) {
    return prisma.whiteboardAsset.update({ where: { id }, data });
  }
}

export type { VideoProcessingStatus, WhiteboardTheme };
