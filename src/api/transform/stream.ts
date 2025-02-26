export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk =
	| ApiStreamTextChunk
	| ApiStreamReasoningChunk
	| ApiStreamUsageChunk
	| ApiStreamThinkingChunk
	| ApiStreamRedactedThinkingChunk
	| ApiStreamThinkingDeltaChunk
	| ApiStreamSignatureDeltaChunk

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamReasoningChunk {
	type: "reasoning"
	reasoning: string
}

export interface ApiStreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number // openrouter
}

export interface ApiStreamThinkingChunk {
	type: "thinking"
	thinking: string
	signature: string
}

export interface ApiStreamRedactedThinkingChunk {
	type: "redacted_thinking"
	data: string
}

export interface ApiStreamThinkingDeltaChunk {
	type: "thinking_delta"
	thinking: string
}

export interface ApiStreamSignatureDeltaChunk {
	type: "signature_delta"
	signature: string
}
