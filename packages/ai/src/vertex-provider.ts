import { GoogleAuth } from 'google-auth-library'
import { validateRecommendationProviderMetadata } from '@hidmo/finance-engine'

import { AnalysisAiError } from './errors.js'
import {
  buildFinancialAnalysisNarrativePrompt,
  buildRecommendationGroundingPrompt,
} from './prompts.js'
import {
  validateFinancialAnalysisNarrative,
  validateGroundedRecommendationResponse,
} from './schema.js'
import type {
  AnalysisNarrativeRequest,
  AnalysisNarrativeResult,
  FinancialAnalysisAiProvider,
  RecommendationGroundingProvider,
  RecommendationGroundingRequest,
  RecommendationGroundingResult,
} from './types.js'

type FetchFunction = typeof fetch

export type VertexAccessTokenProvider = () => Promise<string>

export type VertexFinancialAnalysisProviderConfiguration = {
  projectId: string
  location: string
  model: string
  endpoint?: string
  temperature?: number
  maxOutputTokens?: number
  fetch?: FetchFunction
  accessTokenProvider?: VertexAccessTokenProvider
}

export type VertexRecommendationGroundingProviderConfiguration =
  VertexFinancialAnalysisProviderConfiguration

type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
    finishReason?: string
  }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

const cloudPlatformScope = 'https://www.googleapis.com/auth/cloud-platform'

function buildModelResourceName(input: {
  projectId: string
  location: string
  model: string
}): string {
  if (input.model.startsWith('projects/')) {
    return input.model
  }

  return [
    `projects/${input.projectId}`,
    `locations/${input.location}`,
    'publishers/google',
    `models/${input.model}`,
  ].join('/')
}

export function buildVertexGenerateContentUrl(input: {
  projectId: string
  location: string
  model: string
  endpoint?: string
}): string {
  const endpoint =
    input.endpoint ?? `${input.location}-aiplatform.googleapis.com`
  const model = buildModelResourceName(input)
  return `https://${endpoint}/v1/${model}:generateContent`
}

export function createGoogleAuthAccessTokenProvider(): VertexAccessTokenProvider {
  const auth = new GoogleAuth({ scopes: [cloudPlatformScope] })

  return async () => {
    const client = await auth.getClient()
    const token = await client.getAccessToken()
    const accessToken =
      typeof token === 'string' ? token : (token.token ?? undefined)

    if (accessToken === undefined || accessToken.length === 0) {
      throw new AnalysisAiError(
        'Vertex AI access token could not be resolved from Application Default Credentials.',
        'AI_PROVIDER_AUTH_FAILED',
      )
    }

    return accessToken
  }
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function extractCandidateText(response: VertexGenerateContentResponse): string {
  const text = response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join('')

  if (text === undefined || text.trim().length === 0) {
    throw new AnalysisAiError(
      'Vertex AI response did not include candidate text.',
      'AI_PROVIDER_RESPONSE_INVALID',
    )
  }

  return stripJsonFence(text)
}

function parseJsonCandidate(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new AnalysisAiError(
      'Vertex AI response was not valid JSON.',
      'AI_PROVIDER_RESPONSE_INVALID',
    )
  }
}

function usageMetadata(response: VertexGenerateContentResponse): {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
} {
  const usage = response.usageMetadata
  return {
    ...(usage?.promptTokenCount === undefined
      ? {}
      : { promptTokens: usage.promptTokenCount }),
    ...(usage?.candidatesTokenCount === undefined
      ? {}
      : { completionTokens: usage.candidatesTokenCount }),
    ...(usage?.totalTokenCount === undefined
      ? {}
      : { totalTokens: usage.totalTokenCount }),
  }
}

export function createVertexFinancialAnalysisProvider(
  configuration: VertexFinancialAnalysisProviderConfiguration,
): FinancialAnalysisAiProvider {
  const fetchImplementation = configuration.fetch ?? fetch
  const accessTokenProvider =
    configuration.accessTokenProvider ?? createGoogleAuthAccessTokenProvider()
  const modelResourceName = buildModelResourceName(configuration)
  const url = buildVertexGenerateContentUrl(configuration)

  return {
    async generateNarrative(
      request: AnalysisNarrativeRequest,
    ): Promise<AnalysisNarrativeResult> {
      const prompt = buildFinancialAnalysisNarrativePrompt(request)
      const accessToken = await accessTokenProvider()
      const response = await fetchImplementation(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: prompt.systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: configuration.temperature ?? 0.2,
            maxOutputTokens: configuration.maxOutputTokens ?? 1_024,
            responseMimeType: 'application/json',
          },
          labels: {
            app: 'hidmo',
            feature: 'financial_analysis',
          },
        }),
      })

      if (!response.ok) {
        throw new AnalysisAiError(
          `Vertex AI generateContent request failed with HTTP ${response.status.toString()}.`,
          'AI_PROVIDER_REQUEST_FAILED',
        )
      }

      const vertexResponse =
        (await response.json()) as VertexGenerateContentResponse
      const candidateJson = parseJsonCandidate(
        extractCandidateText(vertexResponse),
      )
      const narrative = validateFinancialAnalysisNarrative(candidateJson)

      return {
        narrative,
        metadata: {
          provider: 'vertex-ai',
          model: modelResourceName,
          promptVersion: prompt.promptVersion,
          outputSchemaVersion: prompt.outputSchemaVersion,
          inputBytes: prompt.payloadBytes,
          outputBytes: Buffer.byteLength(JSON.stringify(narrative), 'utf8'),
          ...usageMetadata(vertexResponse),
        },
      }
    },
  }
}

export function createVertexRecommendationGroundingProvider(
  configuration: VertexRecommendationGroundingProviderConfiguration,
): RecommendationGroundingProvider {
  const fetchImplementation = configuration.fetch ?? fetch
  const accessTokenProvider =
    configuration.accessTokenProvider ?? createGoogleAuthAccessTokenProvider()
  const modelResourceName = buildModelResourceName(configuration)
  const url = buildVertexGenerateContentUrl(configuration)

  return {
    async rankAndExplain(
      request: RecommendationGroundingRequest,
    ): Promise<RecommendationGroundingResult> {
      const startedAt = Date.now()
      const prompt = buildRecommendationGroundingPrompt(request)
      const accessToken = await accessTokenProvider()
      const response = await fetchImplementation(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: prompt.systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: configuration.temperature ?? 0.1,
            maxOutputTokens: configuration.maxOutputTokens ?? 1_024,
            responseMimeType: 'application/json',
          },
          labels: {
            app: 'hidmo',
            feature: 'recommendations',
          },
        }),
      })

      if (!response.ok) {
        throw new AnalysisAiError(
          `Vertex AI generateContent request failed with HTTP ${response.status.toString()}.`,
          'AI_PROVIDER_REQUEST_FAILED',
        )
      }

      const vertexResponse =
        (await response.json()) as VertexGenerateContentResponse
      const candidateJson = parseJsonCandidate(
        extractCandidateText(vertexResponse),
      )
      const recommendations = validateGroundedRecommendationResponse(
        candidateJson,
        request.candidates,
        request.evidence,
      )

      return {
        recommendations,
        metadata: validateRecommendationProviderMetadata({
          provider: 'vertex-ai',
          model: modelResourceName,
          promptVersion: prompt.promptVersion,
          outputSchemaVersion: prompt.outputSchemaVersion,
          inputBytes: prompt.payloadBytes,
          outputBytes: Buffer.byteLength(
            JSON.stringify({ recommendations }),
            'utf8',
          ),
          latencyMs: Date.now() - startedAt,
          ...usageMetadata(vertexResponse),
        }),
      }
    },
  }
}
