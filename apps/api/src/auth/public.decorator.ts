import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as intentionally unauthenticated. The global JwtAuthGuard
 * skips any handler/controller carrying this metadata. Use ONLY for the
 * endpoints that were deliberately built without auth: auth register/login/
 * refresh and the public report-verification endpoint.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
