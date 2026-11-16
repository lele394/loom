import type { FastifyRequest } from 'fastify';
import type { PublicUser } from '../../shared/types';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
    sessionId?: string;
    csrfToken?: string;
    requestId: string;
  }
}

export type AuthedRequest = FastifyRequest & {
  user: PublicUser;
  sessionId: string;
  csrfToken: string;
};
