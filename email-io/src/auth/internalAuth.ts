import { FastifyPluginAsync } from 'fastify';

export const internalAuthPlugin: FastifyPluginAsync = async (fastify) => {
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY?.trim();
  if (!INTERNAL_API_KEY) {
    throw new Error('INTERNAL_API_KEY is required to start the email-io service');
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const receivedKey = request.headers['x-internal-api-key'];
    if (typeof receivedKey !== 'string' || receivedKey !== INTERNAL_API_KEY) {
      reply
        .status(401)
        .send({ ok: false, error: 'UNAUTHORIZED', message: 'Missing or invalid internal API key' });
      return reply;
    }
  });
};
