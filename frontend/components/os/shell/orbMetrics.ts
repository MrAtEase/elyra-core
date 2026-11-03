export const ORB_TOP_PX = 18;
export const ORB_SIZE_DESKTOP_PX = 56;
export const ORB_SIZE_MOBILE_PX = 48;

export function orbSizeForViewport() {
  if (typeof window === "undefined") return ORB_SIZE_DESKTOP_PX;
  return window.innerWidth < 640 ? ORB_SIZE_MOBILE_PX : ORB_SIZE_DESKTOP_PX;
}
