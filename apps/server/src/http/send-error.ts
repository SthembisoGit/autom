import type { FastifyReply } from 'fastify';

import { badRequest, toErrorResponse } from '../lib/errors.js';

export function sendValidationError(reply: FastifyReply, details: unknown) {
  const response = toErrorResponse(
    badRequest('Invalid request payload.', details),
    'Invalid request.'
  );
  reply.code(response.statusCode);
  return response.payload;
}

export function sendServiceError(reply: FastifyReply, error: unknown, fallbackMessage: string) {
  const response = toErrorResponse(error, fallbackMessage);
  reply.code(response.statusCode);
  return response.payload;
}
