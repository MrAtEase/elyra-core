import { z } from "zod";

export const artifactTypeSchema = z.enum([
  "research_report",
  "weather_forecast",
  "translation_result",
  "slides_deck_link",
  "drive_file",
  "document",
]);

export const artifactUiCardHintSchema = z.enum([
  "card.research_report",
  "card.weather_forecast",
  "card.translation_result",
  "card.slides_deck_link",
  "card.drive_file",
  "card.document",
  "card.build_plan",
  "card.process_doc",
  "card.business_document",
  "card.weekly_review",
  "card.generic",
]);

export const createArtifactSchema = z.object({
  workspace_id: z.string().min(1),
  run_id: z.string().min(1),
  tool_call_id: z.string().min(1),
  artifact_type: artifactTypeSchema,
  title: z.string().min(1),
  ui_card_hint: artifactUiCardHintSchema,
  link_url: z.string().url().nullable().optional(),
  payload_json: z.record(z.string(), z.unknown()).default({}),
  metadata_json: z.record(z.string(), z.unknown()).default({}),
});

export const listArtifactsQuerySchema = z.object({
  workspace_id: z.string().min(1),
  run_id: z.string().optional(),
  tool_call_id: z.string().optional(),
  artifact_type: artifactTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type ArtifactUiCardHint = z.infer<typeof artifactUiCardHintSchema>;
export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;
export type ListArtifactsQuery = z.infer<typeof listArtifactsQuerySchema>;

export function defaultUiCardHintForType(type: ArtifactType): ArtifactUiCardHint {
  switch (type) {
    case "research_report":
      return "card.research_report";
    case "weather_forecast":
      return "card.weather_forecast";
    case "translation_result":
      return "card.translation_result";
    case "slides_deck_link":
      return "card.slides_deck_link";
    case "drive_file":
      return "card.drive_file";
    case "document":
      return "card.document";
    default:
      return "card.generic";
  }
}

