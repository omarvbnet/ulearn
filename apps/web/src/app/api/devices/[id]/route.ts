import { error, json, requireAuth } from "@/lib/api";
import { DeviceService } from "@/services/device.service";

/** Deactivate one of the current user's devices (frees a device slot). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await DeviceService.deactivateDevice(auth.session.userId, id);
  if (!result.success) return error("Device not found", 404, result.error);

  return json({ success: true });
}
