import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { intentRoutes } from "./routes/intent.js";
import { runRoutes } from "./routes/runs.js";
import { googleOAuthRoutes } from "./routes/google-oauth.js";
import { gmailRoutes } from "./routes/gmail.js";
import { calendarRoutes } from "./routes/calendar.js";
import { brainFoundationRoutes } from "./routes/brain-foundation.js";
import { assistantAuthRoutes } from "./routes/assistant-auth.js";
import { googleStatusRoutes } from "./routes/google-status.js";
import { chatRoutes } from "./routes/chat.js";
import { graphRoutes } from "./routes/graph.js";
import { workspaceSummaryRoutes } from "./routes/workspace-summary.js";
import { authPlugin } from "./middleware/auth.js";
import "./tools/index.js"; // register all tools

async function main() {
  const env = loadConfig();

  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: [
      env.FRONTEND_URL,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://app.elyra-core.app",
    ],
    credentials: true,
    preflight: true,
  });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
      return;
    }
    logger.error(error, "Unhandled error");
    reply.status(500).send({
      error: "INTERNAL_ERROR",
      message: env.NODE_ENV === "production" ? "Internal server error" : String(error),
    });
  });

  // Only register mock tools in demo mode
  if (process.env.ELYRA_MOCK_MODE === "true") {
    const { registerMockTools } = await import("./mock/fallback-tools.js");
    registerMockTools();
    logger.info("Mock tools registered (ELYRA_MOCK_MODE=true)");
  }

  // Register plugins and routes
  await app.register(healthRoutes);
  await authPlugin(app);
  await app.register(assistantAuthRoutes);
  await app.register(intentRoutes);
  await app.register(runRoutes);
  await app.register(googleOAuthRoutes);
  await app.register(googleStatusRoutes);
  await app.register(chatRoutes);
  await app.register(graphRoutes);
  await app.register(workspaceSummaryRoutes);
  await app.register(gmailRoutes);
  await app.register(calendarRoutes);
  await app.register(brainFoundationRoutes);

  // Start
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info(`ai-service listening on :${env.PORT}`);
}

main().catch((err) => {
  logger.fatal(err, "Failed to start ai-service");
  process.exit(1);
});
