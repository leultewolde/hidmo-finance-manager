export class AnalysisAiError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'AI_PAYLOAD_TOO_LARGE'
      | 'AI_PAYLOAD_BLOCKED_FIELD'
      | 'AI_OUTPUT_INVALID',
  ) {
    super(message)
    this.name = 'AnalysisAiError'
  }
}
