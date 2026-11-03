import Fastify from 'fastify';
import { loadEnv } from './lib/env.js';
loadEnv();

import { EmailIoError } from './errors/EmailIoError.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerIcloudRoutes } from './routes/icloud.js';
import { registerGmailRoutes } from './routes/gmail.js';
import { internalAuthPlugin } from './auth/internalAuth.js';

const PORT: number = Number(process.env.PORT) || 3001;

const app = Fastify({ logger: true, ignoreTrailingSlash: true });

app.register(internalAuthPlugin);
app.register(registerHealthRoutes);
app.register(registerIcloudRoutes);
app.register(registerGmailRoutes);

app.setErrorHandler((error, _, reply) => {
  if (error instanceof EmailIoError) {
    reply.status(error.statusCode).send({ ok: false, error: error.code, message: error.message });
    return;
  }

  app.log.error(error);
  reply.status(500).send({ ok: false, error: 'INTERNAL_ERROR', message: 'Internal server error' });
});

const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`email-io listening on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
