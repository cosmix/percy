import type { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../index"
import { ApiHandlerOptions, ModelInfo, vertexDefaultModelId, VertexModelId, vertexModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { getThinkingBudget, getThinkingTemperature, isThinkingEnabled } from "../utils/thinking-mode"

// https://docs.anthropic.com/en/api/claude-on-vertex-ai
export class VertexHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: AnthropicVertex

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new AnthropicVertex({
			projectId: this.options.vertexProjectId,
			// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
			region: this.options.vertexRegion,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const modelId = model.id

		// Determine max_tokens value based on model capabilities
		let maxTokens: number
		if (model.info.supportsThinking) {
			maxTokens = Math.min(this.options.maxTokens || 8192, 64000)
		} else {
			maxTokens = model.info.maxTokens || 8192
		}

		// Get thinking budget using utility function
		const budget_tokens = getThinkingBudget(model.info, this.options.thinkingMode, maxTokens)
		const reasoningOn = isThinkingEnabled(model.info) && budget_tokens > 0

		let stream
		switch (modelId) {
			case "claude-3-7-sonnet@20250219":
			case "claude-3-5-sonnet-v2@20241022":
			case "claude-3-5-sonnet@20240620":
			case "claude-3-5-haiku@20241022":
			case "claude-3-opus@20240229":
			case "claude-3-haiku@20240307": {
				// Find indices of user messages for cache control
				const userMsgIndices = messages.reduce(
					(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
					[] as number[],
				)
				const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
				const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

				// Create request parameters
				const requestParams: any = {
					model: modelId,
					max_tokens: maxTokens,
					temperature: reasoningOn ? getThinkingTemperature(model.info, this.options.thinkingMode) : 0,
					system: [
						{
							text: systemPrompt,
							type: "text",
							cache_control: { type: "ephemeral" },
						},
					],
					messages: messages.map((message, index) => {
						if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
							return {
								...message,
								content:
									typeof message.content === "string"
										? [
												{
													type: "text",
													text: message.content,
													cache_control: {
														type: "ephemeral",
													},
												},
											]
										: message.content.map((content, contentIndex) =>
												contentIndex === message.content.length - 1
													? {
															...content,
															cache_control: {
																type: "ephemeral",
															},
														}
													: content,
											),
							}
						}
						return {
							...message,
							content:
								typeof message.content === "string"
									? [
											{
												type: "text",
												text: message.content,
											},
										]
									: message.content,
						}
					}),
					stream: true,
				}

				// Add thinking parameter if reasoning is enabled
				// Using 'as any' because the Vertex API SDK types might not be up-to-date
				// with the latest Claude features like thinking
				if (reasoningOn) {
					requestParams.thinking = {
						type: "enabled",
						budget_tokens: Math.min(budget_tokens, maxTokens),
					}
				}

				// Use double casting to avoid TypeScript errors - first to unknown, then to AsyncIterable
				stream = (await this.client.beta.messages.create(requestParams, { headers: {} })) as unknown as AsyncIterable<any>
				break
			}
			default: {
				// Create request parameters for default case
				const requestParams: any = {
					model: modelId,
					max_tokens: maxTokens,
					temperature: 0,
					system: [
						{
							text: systemPrompt,
							type: "text",
						},
					],
					messages: messages.map((message) => ({
						...message,
						content:
							typeof message.content === "string"
								? [
										{
											type: "text",
											text: message.content,
										},
									]
								: message.content,
					})),
					stream: true,
				}

				// Force the stream type to ensure TypeScript knows this is a streamable response
				// Use double casting to avoid TypeScript errors - first to unknown, then to AsyncIterable
				stream = (await this.client.beta.messages.create(requestParams, { headers: {} })) as unknown as AsyncIterable<any>
				break
			}
		}

		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start": {
					const usage = chunk.message?.usage || {}
					yield {
						type: "usage",
						inputTokens: usage.input_tokens ?? 0,
						outputTokens: usage.output_tokens ?? 0,
						cacheWriteTokens: usage.cache_creation_input_tokens,
						cacheReadTokens: usage.cache_read_input_tokens,
					}
					break
				}
				case "message_delta": {
					const usage = chunk.usage || {}
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: usage.output_tokens ?? 0,
					}
					break
				}
				case "message_stop":
					break
				case "content_block_start": {
					const contentBlock = chunk.content_block || ({} as any)
					const blockType = contentBlock.type

					switch (blockType) {
						case "text":
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							if (contentBlock.text) {
								yield {
									type: "text",
									text: contentBlock.text,
								}
							}
							break
						case "thinking":
							// Convert thinking chunks to reasoning chunks for display in the UI
							if (contentBlock.thinking) {
								yield {
									type: "reasoning",
									reasoning: contentBlock.thinking,
								}
								// Also yield the original thinking chunk for internal use
								yield {
									type: "thinking",
									thinking: contentBlock.thinking,
									signature: contentBlock.signature,
								}
							}
							break
						case "redacted_thinking":
							yield {
								type: "redacted_thinking",
								data: contentBlock.data,
							}
							break
					}
					break
				}
				case "content_block_delta": {
					const delta = chunk.delta || ({} as any)
					const deltaType = delta.type

					switch (deltaType) {
						case "text_delta":
							if (delta.text) {
								yield {
									type: "text",
									text: delta.text,
								}
							}
							break
						case "thinking_delta":
							// Convert thinking_delta chunks to reasoning chunks for display in the UI
							if (delta.thinking) {
								yield {
									type: "reasoning",
									reasoning: delta.thinking,
								}
								// Also yield the original thinking_delta chunk for internal use
								yield {
									type: "thinking_delta",
									thinking: delta.thinking,
								}
							}
							break
						case "signature_delta":
							if (delta.signature) {
								yield {
									type: "signature_delta",
									signature: delta.signature,
								}
							}
							break
					}
					break
				}
				case "content_block_stop":
					break
			}
		}
	}

	getModel(): { id: VertexModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in vertexModels) {
			const id = modelId as VertexModelId
			return { id, info: vertexModels[id] }
		}
		return {
			id: vertexDefaultModelId,
			info: vertexModels[vertexDefaultModelId],
		}
	}
}
