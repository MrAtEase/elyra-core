import { registerTool } from "./registry.js";
import { callModel } from "../models/router.js";
import { getGoogleAccessToken } from "./google-auth.js";

registerTool("slides.create", async (input) => {
  const title = input["title"] as string;
  const slides = input["slides"] as Array<{ title: string; bullets: string[] }> | undefined;

  if (slides && slides.length > 0) {
    // User already has structure, just format
    return {
      deck: { title, slides },
      text: `Created slide deck "${title}" with ${slides.length} slides`,
    };
  }

  // Generate slide structure from title
  const response = await callModel(
    `You create slide deck outlines. Given a topic, produce a JSON array of slides.
Each slide: { "title": "...", "bullets": ["...", "..."] }
Produce 5-8 slides. Respond with valid JSON array only.`,
    `Create a slide deck about: ${title}`,
    { json: true },
  );

  let generatedSlides: Array<{ title: string; bullets: string[] }>;
  try {
    generatedSlides = JSON.parse(response.text) as Array<{ title: string; bullets: string[] }>;
  } catch {
    generatedSlides = [{ title, bullets: ["Content generation failed — please try again"] }];
  }

  return {
    deck: { title, slides: generatedSlides },
    text: `Created slide deck "${title}" with ${generatedSlides.length} slides`,
  };
});

const SLIDES_API = "https://slides.googleapis.com/v1/presentations";

registerTool("slides.publish", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Google account not connected. Please connect your Google account in Settings.", connected: false };
  }

  const title = typeof input["title"] === "string" ? input["title"].trim() : "Untitled Presentation";
  let slides = input["slides"] as Array<{ title: string; body?: string; bullets?: string[] }> | undefined;

  if (!slides || slides.length === 0) {
    const response = await callModel(
      `You create slide deck outlines. Given a topic, produce a JSON array of slides.
Each slide: { "title": "...", "bullets": ["...", "..."] }
Produce 5-8 slides. Respond with valid JSON array only.`,
      `Create a slide deck about: ${title}`,
      { json: true },
    );
    try {
      slides = JSON.parse(response.text) as Array<{ title: string; bullets: string[] }>;
    } catch {
      slides = [{ title, body: "Content generation failed — please try again" }];
    }
  }

  // Create presentation
  const createRes = await fetch(SLIDES_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!createRes.ok) {
    return { text: `Failed to create presentation: ${createRes.status}` };
  }
  const created = (await createRes.json()) as { presentationId?: string; slides?: Array<{ objectId?: string }> };
  const presentationId = created.presentationId;
  if (!presentationId) return { text: "Failed to create presentation: no ID returned" };

  const firstSlideId = created.slides?.[0]?.objectId;
  const requests: Array<Record<string, unknown>> = [];
  if (firstSlideId) requests.push({ deleteObject: { objectId: firstSlideId } });

  slides.forEach((slide, index) => {
    const slideId = `slide_${index + 1}`;
    const titleId = `slide_${index + 1}_title`;
    const bodyId = `slide_${index + 1}_body`;
    const bodyLines = Array.isArray(slide.bullets) && slide.bullets.length > 0
      ? slide.bullets.map((b: string) => `• ${b}`)
      : [slide.body ?? ""];
    const bodyText = bodyLines.filter(Boolean).join("\n");

    requests.push({ createSlide: { objectId: slideId, insertionIndex: index, slideLayoutReference: { predefinedLayout: "BLANK" } } });
    requests.push({ createShape: { objectId: titleId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 600, unit: "PT" }, height: { magnitude: 70, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: 40, translateY: 36, unit: "PT" } } } });
    requests.push({ insertText: { objectId: titleId, insertionIndex: 0, text: slide.title.trim() } });
    requests.push({ updateTextStyle: { objectId: titleId, style: { bold: true, fontSize: { magnitude: index === 0 ? 28 : 24, unit: "PT" } }, textRange: { type: "ALL" }, fields: "bold,fontSize" } });
    if (bodyText) {
      requests.push({ createShape: { objectId: bodyId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 600, unit: "PT" }, height: { magnitude: 300, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: 44, translateY: index === 0 ? 150 : 128, unit: "PT" } } } });
      requests.push({ insertText: { objectId: bodyId, insertionIndex: 0, text: bodyText } });
      requests.push({ updateTextStyle: { objectId: bodyId, style: { fontSize: { magnitude: 16, unit: "PT" } }, textRange: { type: "ALL" }, fields: "fontSize" } });
    }
  });

  const updateRes = await fetch(`${SLIDES_API}/${encodeURIComponent(presentationId)}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!updateRes.ok) {
    return { text: `Presentation created but batch update failed: ${updateRes.status}`, presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` };
  }

  const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  return {
    presentationId,
    url,
    slideCount: slides.length,
    text: `Created presentation "${title}" with ${slides.length} slides: ${url}`,
  };
});
