type PermissionAwareDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export async function requestDeviceOrientationPermission(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === "undefined") return false;
  const eventType = DeviceOrientationEvent as PermissionAwareDeviceOrientationEvent;
  if (!eventType.requestPermission) return true;
  return (await eventType.requestPermission()) === "granted";
}
