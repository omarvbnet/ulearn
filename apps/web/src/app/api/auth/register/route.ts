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
});

const schema = z.discriminatedUnion("type", [studentSchema, certificateSchema]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      console.warn("[auth/register] validation failed", details);
      return error("Validation failed", 400, "VALIDATION_ERROR", { details });
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
      return error(result.error, 400, result.error);
    }

    return json(result, 201);
  } catch (e) {
    console.error(e);
    return error("Internal server error", 500);
  }
}
