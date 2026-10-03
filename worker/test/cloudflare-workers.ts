// Minimal stand-in for the `cloudflare:workers` runtime module, used only by unit tests.
export class DurableObject {
  constructor(
    protected ctx: unknown,
    protected env: unknown,
  ) {}
}
