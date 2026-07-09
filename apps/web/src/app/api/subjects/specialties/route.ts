import { json } from "@/lib/api";
import { TeacherProfileService } from "@/services/teacher-profile.service";

/** Public catalog of teaching specialties (stage-agnostic subjects). */
export async function GET(request: Request) {
  const countryId = new URL(request.url).searchParams.get("countryId") ?? undefined;
  const subjects = await TeacherProfileService.listAvailableSpecialties(countryId);
  return json({ subjects });
}
