/** Single source of the API base + error type shared by the API client and the auth module. */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Best-effort message extraction from a non-2xx JSON error body. */
export async function parseErrorBody(res: Response): Promise<string> {
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      message = body.message.join(', ');
    } else if (typeof body.message === 'string') {
      message = body.message;
    }
  } catch {
    // non-JSON error body — keep the generic message
  }
  return message;
}
