const DEFAULT_ACCENT = "#5cffec";
const DEFAULT_DARK_TEXT = "#0a0b0f";
const DEFAULT_LIGHT_TEXT = "#ffffff";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseHexColor = (value: string): Rgb | null => {
  const trimmed = value.trim().replace("#", "");
  const normalized =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b };
};

export const normalizeHexColor = (value: string, fallback = DEFAULT_ACCENT): string => {
  const parsed = parseHexColor(value);
  if (!parsed) {
    return fallback;
  }
  const hex = [parsed.r, parsed.g, parsed.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
};

export const hexToRgba = (value: string, alpha: number, fallback = DEFAULT_ACCENT): string => {
  const parsed = parseHexColor(value) ?? parseHexColor(fallback);
  const safeAlpha = clamp(alpha, 0, 1);
  if (!parsed) {
    return `rgba(92, 255, 236, ${safeAlpha})`;
  }
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${safeAlpha})`;
};

const relativeLuminance = ({ r, g, b }: Rgb) => {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const contrastRatio = (a: Rgb, b: Rgb) => {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
};

export const pickTextColor = (
  background: string,
  lightText = DEFAULT_LIGHT_TEXT,
  darkText = DEFAULT_DARK_TEXT
): string => {
  const bg = parseHexColor(background) ?? parseHexColor(DEFAULT_ACCENT);
  const light = parseHexColor(lightText) ?? parseHexColor(DEFAULT_LIGHT_TEXT);
  const dark = parseHexColor(darkText) ?? parseHexColor(DEFAULT_DARK_TEXT);
  if (!bg || !light || !dark) {
    return DEFAULT_DARK_TEXT;
  }
  const lightContrast = contrastRatio(bg, light);
  const darkContrast = contrastRatio(bg, dark);
  return lightContrast >= darkContrast ? lightText : darkText;
};
