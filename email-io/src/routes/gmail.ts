import { FastifyPluginAsync } from 'fastify';
import { listGmailMessages, getGmailMessage, sendGmailMessage } from '../lib/gog.js';
import { EmailIoError } from '../errors/EmailIoError.js';

export const registerGmailRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/gmail/list', async (request) => {
    try {
      const limit = Number((request.query as any).limit) || 10;
      const messages = await listGmailMessages(limit);
      return { ok: true, messages };
    } catch (err: any) {
      throw new EmailIoError('GMAIL_ERROR', err.message, 502);
    }
  });

  fastify.get('/gmail/:id', async (request) => {
    try {
      const { id } = request.params as { id: string };
      const message = await getGmailMessage(id);
      return { ok: true, message };
    } catch (err: any) {
      throw new EmailIoError('GMAIL_ERROR', err.message, 502);
    }
  });

  fastify.post('/gmail/send', async (request) => {
    try {
      const { to, subject, body } = request.body as { to: string; subject: string; body: string };
      if (!to || !subject || !body) {
        throw new EmailIoError('INVALID_REQUEST', 'Missing to, subject, or body', 400);
      }
      const result = await sendGmailMessage(to, subject, body);
      return { ok: true, messageId: result.id };
    } catch (err: any) {
      if (err instanceof EmailIoError) throw err;
      throw new EmailIoError('GMAIL_ERROR', err.message, 502);
    }
  });
};
