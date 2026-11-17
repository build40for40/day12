import Anthropic, { APIError } from '@anthropic-ai/sdk'

/** An API error that asking again won't fix: a bad key, a bad request or a missing model. The SDK already retried the rest. */
export function permanentFailure(error: unknown): error is APIError {
  return (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  )
}
