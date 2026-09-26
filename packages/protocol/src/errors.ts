export type JamErrorCode =
  | 'invalid_request'
  | 'unsupported_version'
  | 'unknown_method'
  | 'invalid_response'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'internal';

/** Stable, safe-to-display error. Provider credentials/details never belong here. */
export class JamError extends Error {
  override readonly name = 'JamError';

  constructor(
    readonly code: JamErrorCode,
    message: string,
  ) {
    super(message);
  }
}
