import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EllyGlassCard from "../components/elly/EllyGlassCard";

const markup = renderToStaticMarkup(
  <EllyGlassCard title="Onboarding overlay test" kicker="Test" tone="focus">
    <span>test</span>
  </EllyGlassCard>
);

if (!markup.includes("ellyGlassCard")) {
  throw new Error("EllyGlassCard must render with the `ellyGlassCard` class so the onboarding overlay stays clickable.");
}

console.log("✔ EllyGlassCard renders with ellyGlassCard class.");
