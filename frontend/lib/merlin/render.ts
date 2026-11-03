export type SummaryDetails = {
  summaryLine?: string;
  bulletLines: string[];
  nextStep?: string;
};

const removeBulletMarkers = (line: string) =>
  line.replace(/^[-•\d\.\)\s]+/, "").trim();

export const stripDebugMarkers = (text?: string): string => {
  if (!text) {
    return "";
  }
  return text
    .replace(/\(Fallback[^)]*\)/gi, "")
    .replace(/Offline-Modus[:\s]*vereinfachte Ausgabe/gi, "")
    .trim();
};

export const detectFallbackMode = (text?: string): boolean => {
  if (!text) {
    return false;
  }
  return /\(Fallback\b/i.test(text) || /Offline-Modus/i.test(text);
};

export const splitIntoParagraphs = (text?: string): string[] => {
  if (!text) {
    return [];
  }
  const normalized = text.trim();
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (paragraphs.length) {
    return paragraphs;
  }
  return normalized
    .split(/\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
};

export const toBulletPoints = (text?: string): string[] => {
  if (!text) {
    return [];
  }
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return [];
  }
  const markerLines = lines.filter((line) => /^[-•\d\.\)]/.test(line));
  const cleaned = lines.map(removeBulletMarkers).filter(Boolean);
  if (markerLines.length >= 2) {
    return cleaned.slice(0, markerLines.length);
  }
  if (cleaned.length >= 3) {
    return cleaned;
  }
  return [];
};

export const parseSummaryResult = (input?: string): SummaryDetails | null => {
  if (!input) {
    return null;
  }
  const normalized = input.replace(/\r/g, "");
  const summaryMatch = normalized.match(
    /Zusammenfassung[:\s]*([\s\S]*?)(?=Wichtigste Punkte|Nächster Schritt|$)/i
  );
  const bulletsMatch = normalized.match(
    /Wichtigste Punkte[:\s]*([\s\S]*?)(?=Nächster Schritt|$)/i
  );
  const nextStepMatch = normalized.match(/Nächster Schritt[:\s]*([\s\S]*)/i);

  const summaryLine = summaryMatch?.[1]
    ?.split("\n")
    ?.map((line) => line.trim())
    ?.filter(Boolean)?.[0];

  const bulletLines =
    bulletsMatch?.[1]
      ?.split(/\r?\n/)
      ?.map((line) => line.replace(/^[-•\d\.\s]+/, "").trim())
      ?.filter(Boolean) ?? [];
  const nextStep = nextStepMatch?.[1]?.trim();

  if (!summaryLine && !bulletLines.length && !nextStep) {
    return null;
  }

  const result: SummaryDetails = {
    bulletLines,
  };
  if (summaryLine) {
    result.summaryLine = summaryLine;
  }
  if (nextStep) {
    result.nextStep = nextStep;
  }
  return result;
};
