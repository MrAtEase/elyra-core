import type { MailLabel } from "@/components/workspace/WorkspaceContext";

export type DisplayMailLabel = {
  id: string;
  name: string;
};

const LABEL_DISPLAY_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Gesendet",
  DRAFT: "Entwürfe",
  SPAM: "Spam",
  TRASH: "Papierkorb",
  STARRED: "Markiert",
  CATEGORY_PROMOTIONS: "Werbung",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Foren",
  IMPORTANT: "Wichtig",
  UNREAD: "Ungelesen",
};

const getLabelName = (id: string) => LABEL_DISPLAY_NAMES[id] ?? id;

export const DEFAULT_MAIL_LABELS: MailLabel[] = [
  { id: "INBOX", name: getLabelName("INBOX") },
  { id: "SENT", name: getLabelName("SENT") },
  { id: "DRAFT", name: getLabelName("DRAFT") },
  { id: "STARRED", name: getLabelName("STARRED") },
  { id: "SPAM", name: getLabelName("SPAM") },
  { id: "TRASH", name: getLabelName("TRASH") },
];

const PRIMARY_LABEL_IDS = ["INBOX", "SENT", "DRAFT", "STARRED"];
const SECONDARY_LABEL_IDS = ["SPAM", "TRASH", "IMPORTANT", "UNREAD"];
const CATEGORY_LABEL_IDS = [
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
];

const NOISY_PREFIXES = ["[Imap]/", "[Gmail]/"];
const NOISY_KEYWORDS = ["archive"];

const isHiddenLabel = (labelId: string) => {
  if (!labelId) return true;
  const normalized = labelId.toLowerCase();
  if (NOISY_PREFIXES.some((prefix) => labelId.startsWith(prefix))) {
    return true;
  }
  return NOISY_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const translateLabel = (label: MailLabel) =>
  LABEL_DISPLAY_NAMES[label.id] ?? label.name ?? label.id;

const createDisplayLabel = (label: MailLabel): DisplayMailLabel => ({
  id: label.id,
  name: translateLabel(label),
});

const createDisplayLabelById = (label: MailLabel | undefined, id: string): DisplayMailLabel => {
  if (label) {
    return createDisplayLabel(label);
  }
  return { id, name: LABEL_DISPLAY_NAMES[id] ?? id };
};

export type GroupedMailLabels = {
  primary: DisplayMailLabel[];
  secondary: DisplayMailLabel[];
  categories: DisplayMailLabel[];
};

export function groupMailLabels(labels: MailLabel[]): GroupedMailLabels {
  const visibleLabels = labels.filter((label) => !isHiddenLabel(label.id));
  const labelById = new Map(visibleLabels.map((label) => [label.id, label]));
  const primarySet = new Set(PRIMARY_LABEL_IDS);
  const secondarySet = new Set(SECONDARY_LABEL_IDS);
  const categorySet = new Set(CATEGORY_LABEL_IDS);

  const primary = PRIMARY_LABEL_IDS.filter((id) => labelById.has(id)).map((id) =>
    createDisplayLabelById(labelById.get(id), id)
  );

  const secondary = [
    ...SECONDARY_LABEL_IDS.filter((id) => labelById.has(id)).map((id) =>
      createDisplayLabelById(labelById.get(id), id)
    ),
  ];

  const extras = visibleLabels
    .filter(
      (label) =>
        !primarySet.has(label.id) &&
        !secondarySet.has(label.id) &&
        !categorySet.has(label.id)
    )
    .map(createDisplayLabel)
    .sort((a, b) => a.name.localeCompare(b.name));

  const categories = CATEGORY_LABEL_IDS.filter((id) => labelById.has(id)).map((id) =>
    createDisplayLabelById(labelById.get(id), id)
  );

  return {
    primary,
    secondary: [...secondary, ...extras],
    categories,
  };
}
