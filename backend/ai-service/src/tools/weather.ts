import { registerTool } from "./registry.js";

type WeatherInput = {
  location?: string | null;
  date?: string | null;
};

registerTool("weather.getForecast", async (input: Record<string, unknown>) => {
  const payload = input as WeatherInput;
  const location = payload.location?.trim() ?? "";
  const when = payload.date?.trim() ?? "";

  if (!location) {
    return {
      text: "Bitte nenne zuerst einen Ort, z. B. \"Berlin\" oder \"Frankfurt am Main\".",
      needsLocation: true,
    };
  }

  return {
    text: "Wetter-Integration noch nicht aktiviert. Sag kurz, welche Stadt du im Blick hast, sobald das Wetter-Tool bereitsteht.",
    location,
    date: when,
  };
});
