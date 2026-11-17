// Stands in for the Workers runtime modules under vitest, which runs in Node. See vitest.config.ts.
export class WorkflowEntrypoint<Env = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: Env,
  ) {}
}

export class NonRetryableError extends Error {
  constructor(message: string, name = 'NonRetryableError') {
    super(message)
    this.name = name
  }
}
