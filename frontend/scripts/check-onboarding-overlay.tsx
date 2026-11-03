import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MerlinGlassCard from "../components/merlin/MerlinGlassCard";

const markup = renderToStaticMarkup(
  <MerlinGlassCard title="Onboarding overlay test" kicker="Test" tone="focus">
    <span>test</span>
  </MerlinGlassCard>
);

if (!markup.includes("merlinGlassCard")) {
  throw new Error("MerlinGlassCard must render with the `merlinGlassCard` class so the onboarding overlay stays clickable.");
}

console.log("✔ MerlinGlassCard renders with merlinGlassCard class.");
