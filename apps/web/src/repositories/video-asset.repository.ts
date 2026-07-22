import type { Prisma, VideoProcessingStatus, VideoScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class VideoAssetRepository {
  create(data: Prisma.VideoAssetCreateInput) {
    return prisma.videoAsset.create({ data });
  }

  findById(id: string) {
    return prisma.videoAsset.findUnique({
      where: { id },
      include: { courseLesson: { include: { course: true } } },
    });
  }

  update(id: string, data: Prisma.VideoAssetUpdateInput) {
    return prisma.videoAsset.update({ where: { id }, data });
  }

  linkToCourseLesson(videoAssetId: string, courseLessonId: string, courseId: string) {
    return prisma.$transaction([
      prisma.videoAsset.update({
        where: { id: videoAssetId },
        data: { courseLessonId, courseId },
      }),
      prisma.courseLesson.update({
        where: { id: courseLessonId },
        data: { videoAssetId, fileKey: undefined },
      }),
    ]);
  }
}

export type { VideoScope, VideoProcessingStatus };
