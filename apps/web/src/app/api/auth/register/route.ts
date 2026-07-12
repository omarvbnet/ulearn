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

const schema = z.discriminatedUnion("type", [studentSchema, certificateSchema]);

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

    const result =
      data.type === "STUDENT"
        ? await AuthService.registerStudent(
            {
              ...data,
              latitude: data.latitude ?? undefined,
              longitude: data.longitude ?? undefined,
            },
            { ipAddress: ip }
          )
        : await AuthService.registerCertificateUser(
            {
              ...data,
              latitude: data.latitude ?? undefined,
              longitude: data.longitude ?? undefined,
            },
            { ipAddress: ip }
          );

    if (!result.success) {
      const code = result.error;
      const human =
        code === "PHONE_EXISTS"
          ? "This phone number is already registered."
          : code === "INTERESTS_REQUIRED"
            ? "Select 1–5 areas of interest."
            : code === "INVALID_INTERESTS"
              ? "One or more areas of interest are invalid."
              : code;
      return error(human, 400, code);
    }

    return json(result, 201);
  } catch (e) {
    console.error(e);
    return error("Internal server error", 500);
  }
}
