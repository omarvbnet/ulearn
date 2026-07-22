import { AuthService } from "@/services/auth.service";
import { error, getClientIp, json } from "@/lib/api";
import { z } from "zod";

/** Accept missing / null / empty as undefined; validate real emails. */
const optionalEmail = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.string().email().optional()
);

const optionalString = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.string().optional()
);

const baseSchema = z.object({
  phone: z.string().min(8),
  fullLegalName: z.string().min(2),
  gender: z.enum(["MALE", "FEMALE"]),
  countryId: z.string().min(1),
  provinceId: z.string().min(1),
  email: optionalEmail,
  nationalId: z.string().min(3),
  nationalIdImage: z.string().min(1),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  locationLabel: optionalString,
  locale: z.enum(["AR", "KU", "TR", "EN"]).optional(),
});

const studentSchema = baseSchema.extend({
  type: z.literal("STUDENT"),
  parentPhone: z.string().min(8),
  parentEmail: optionalEmail,
  educationalStageId: z.string().min(1),
  grade: optionalString,
  schoolUniversity: optionalString,
});

const certificateSchema = baseSchema.extend({
  type: z.literal("CERTIFICATE"),
  educationalQualification: optionalString,
  specialization: optionalString,
  occupation: optionalString,
  interestSubjectIds: z.array(z.string().min(1)).min(1).max(5),
});

const teacherSchoolSchema = baseSchema.extend({
  type: z.literal("TEACHER_SCHOOL"),
  bio: optionalString,
  subjectIds: z.array(z.string().min(1)).min(1).max(3),
});

const teacherCertificateSchema = baseSchema.extend({
  type: z.literal("TEACHER_CERTIFICATE"),
  bio: optionalString,
  /** Same insights catalog as certificate users. */
  subjectIds: z.array(z.string().min(1)).min(1).max(5),
});

const schema = z.discriminatedUnion("type", [
  studentSchema,
  certificateSchema,
  teacherSchoolSchema,
  teacherCertificateSchema,
]);

const FIELD_MESSAGES: Record<string, string> = {
  phone: "Phone number is required (at least 8 digits).",
  fullLegalName: "Full legal name is required.",
  gender: "Please select a gender.",
  countryId: "Please select a country.",
  provinceId: "Please select a province.",
  email: "Email address is invalid.",
  nationalId: "National ID is required.",
  nationalIdImage: "Please upload your national ID image.",
  parentPhone: "Parent phone is required (at least 8 digits).",
  parentEmail: "Parent email is invalid. Leave it blank or enter a valid email.",
  educationalStageId: "Please select your educational stage.",
  interestSubjectIds: "Select 1–5 areas of interest.",
  subjectIds: "Select your teaching subjects / insights.",
};

function friendlyValidationMessage(
  issues: { path: string; message: string }[]
): string {
  const messages = issues.map((i) => {
    const field = i.path.split(".").pop() || i.path;
    if (FIELD_MESSAGES[field]) return FIELD_MESSAGES[field];
    if (FIELD_MESSAGES[i.path]) return FIELD_MESSAGES[i.path];
    if (/email/i.test(i.message) || /email/i.test(field)) {
      return `${field} is not a valid email address.`;
    }
    if (/too small|required|min/i.test(i.message)) {
      return `${field} is required.`;
    }
    return `${field}: ${i.message}`;
  });
  return [...new Set(messages)].join(" ");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      const message = friendlyValidationMessage(details);
      console.warn("[auth/register] validation failed", details);
      return error(message || "Validation failed", 400, "VALIDATION_ERROR", {
        details,
      });
    }

    const ip = getClientIp(request);
    const data = parsed.data;
    const coords = {
      latitude: data.latitude ?? undefined,
      longitude: data.longitude ?? undefined,
    };

    let result;
    if (data.type === "STUDENT") {
      result = await AuthService.registerStudent(
        { ...data, ...coords },
        { ipAddress: ip }
      );
    } else if (data.type === "CERTIFICATE") {
      result = await AuthService.registerCertificateUser(
        { ...data, ...coords },
        { ipAddress: ip }
      );
    } else {
      result = await AuthService.registerTeacher(
        {
          ...data,
          ...coords,
          teachingTrack:
            data.type === "TEACHER_CERTIFICATE" ? "CERTIFICATE" : "SCHOOL",
        },
        { ipAddress: ip }
      );
    }

    if (!result.success) {
      const messages: Record<string, string> = {
        PHONE_EXISTS: "This phone number is already registered.",
        INTERESTS_REQUIRED: "Select 1–5 areas of interest.",
        INVALID_INTERESTS: "One or more selected insights are invalid.",
        SPECIALTIES_REQUIRED: "Select 1–3 teaching specialties.",
        INVALID_SPECIALTIES: "One or more specialties are invalid.",
      };
      return error(
        messages[result.error] || result.error,
        400,
        result.error
      );
    }

    return json(result, 201);
  } catch (e) {
    console.error("[auth/register]", e);
    return error("Internal server error", 500);
  }
}
