/** An error whose message is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Please sign in.') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, msg, 'forbidden');
export const notFoundError = (msg = 'Not found.') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');
