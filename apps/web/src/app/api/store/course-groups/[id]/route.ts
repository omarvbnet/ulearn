import { error, json, optionalAuth } from "@/lib/api";
import { CourseGroupService } from "@/services/course-group.service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await optionalAuth();
  const { id } = await params;
  const group = await CourseGroupService.getPublic(id, session?.userId);
  if (!group) return error("Not found", 404, "NOT_FOUND");
  return json({ group });
}
