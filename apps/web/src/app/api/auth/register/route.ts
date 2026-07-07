import { AuthService } from "@/services/auth.service";
import { error, getClientIp, json } from "@/lib/api";
import { z } from "zod";

const baseSchema = z.object({
  phone: z.string().min(8),
  fullLegalName: z.string().min(2),
  gender: z.enum(["MALE", "FEMALE"]),
  countryId: z.string(),
  provinceId: z.string(),
  email: z.string().email().optional(),
  nationalId: z.string().min(3),
  nationalIdImage: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  locationLabel: z.string().optional(),
  locale: z.enum(["AR", "KU", "TR", "EN"]).optional(),
});

const studentSchema = baseSchema.extend({
  type: z.literal("STUDENT"),
  parentPhone: z.string().min(8),
  educationalStageId: z.string().optional(),
  grade: z.string().optional(),
  schoolUniversity: z.string().optional(),
});

const certificateSchema = baseSchema.extend({
  type: z.literal("CERTIFICATE"),
  educationalQualification: z.string().optional(),
  specialization: z.string().optional(),
  occupation: z.string().optional(),
});

const schema = z.discriminatedUnion("type", [studentSchema, certificateSchema]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return error("Validation failed", 400, "VALIDATION_ERROR");
    }

    const ip = getClientIp(request);
    const data = parsed.data;

    const result =
      data.type === "STUDENT"
        ? await AuthService.registerStudent(data, { ipAddress: ip })
        : await AuthService.registerCertificateUser(data, { ipAddress: ip });

    if (!result.success) {
      return error(result.error, 400, result.error);
    }

    return json(result, 201);
  } catch (e) {
    console.error(e);
    return error("Internal server error", 500);
  }
}
