import { VideoPlaybackService } from "@/services/video-playback.service";

/** Playback URLs only — no server-side FFmpeg. Watermark is burned in on upload (client-side). */
export class VideoWatermarkService {
  static getStoreLessonWatermarkedUrl(userId: string, lessonId: string) {
    return VideoPlaybackService.getStoreLessonPlaybackUrl(userId, lessonId);
  }

  static getCurriculumLessonWatermarkedUrl(
    userId: string,
    lessonId: string,
    contentId?: string
  ) {
    return VideoPlaybackService.getCurriculumLessonPlaybackUrl(userId, lessonId, contentId);
  }
}
