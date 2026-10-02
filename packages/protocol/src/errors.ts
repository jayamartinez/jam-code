/** Every code the runtime may answer with. A transport passes these through. */
export const JAM_ERROR_CODES = [
  'invalid_request',
  'unsupported_version',
  'unknown_method',
  'invalid_response',
  'not_found',
  'conflict',
  'unavailable',
  'internal',
  /** An approval or question that is no longer waiting for an answer. */
  'stale',
  /** The provider cannot do this, such as images with a text-only model. */
  'unsupported',
  'provider_unavailable',
  'provider_disabled',
  'provider_error',
  'provider_exited',
  'project_folder_required',
] as const;
export type JamErrorCode = (typeof JAM_ERROR_CODES)[number];

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
