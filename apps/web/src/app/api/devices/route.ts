import { json, requireAuth } from "@/lib/api";
import { DeviceService } from "@/services/device.service";

/** List the current user's registered devices and their device limit. */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const [devices, limit] = await Promise.all([
    DeviceService.listDevices(auth.session.userId),
    DeviceService.getDeviceLimit(auth.session.userId),
  ]);

  return json({ devices, limit });
}
