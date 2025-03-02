import AnthropicBedrock from "@anthropic-ai/bedrock-sdk"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, bedrockDefaultModelId, BedrockModelId, bedrockModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { getThinkingBudget, getThinkingTemperature, isThinkingEnabled } from "../utils/thinking-mode"

// https://docs.anthropic.com/en/api/claude-on-amazon-bedrock
export class AwsBedrockHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// cross region inference requires prefixing the model id with the region
		const modelId = await this.getModelId()

		// create anthropic client, using sessions created or renewed after this handler's
		// initialization, and allowing for session renewal if necessary as well
		const client = await this.getClient()

		const model = this.getModel()

		// Determine max_tokens value based on model capabilities
		let maxTokens = model.info.maxTokens || 8192
		if (model.info.supportsThinking) {
			maxTokens = Math.min(this.options.maxTokens || 8192, 64000)
		}

		// Default temperature is 0
		let temperature = 0

		// Prepare request options
		const requestOptions: Record<string, any> = {}

		// Get thinking budget using utility function
		const thinkingBudget = getThinkingBudget(model.info, this.options.thinkingMode, maxTokens)

		// Add thinking parameter if budget is greater than 0
		if (isThinkingEnabled(model.info, this.options.thinkingMode) && thinkingBudget > 0) {
			// Set thinking parameter
			requestOptions.thinking = {
				type: "enabled",
				budget_tokens: thinkingBudget,
			}

			// Set temperature using utility function
			temperature = getThinkingTemperature(model.info, this.options.thinkingMode) || 0
		}

		const stream = await client.messages.create({
			model: modelId,
			max_tokens: maxTokens,
			temperature: temperature,
			system: systemPrompt,
			messages,
			stream: true,
			...requestOptions,
		})
		for await (const chunk of stream) {
			switch (chunk.type) {
				case "message_start":
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
					}
					break
				case "message_delta":
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break

				case "content_block_start":
					switch (chunk.content_block.type) {
						case "text":
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
						case "thinking":
							// Convert thinking chunks to reasoning chunks for display in the UI
							if (chunk.content_block.thinking) {
								yield {
									type: "reasoning",
									reasoning: chunk.content_block.thinking,
								}
								// Also yield the original thinking chunk for internal use
								yield {
									type: "thinking",
									thinking: chunk.content_block.thinking,
									signature: chunk.content_block.signature,
								}
							}
							break
						case "redacted_thinking":
							yield {
								type: "redacted_thinking",
								data: chunk.content_block.data,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
						case "thinking_delta":
							// Convert thinking_delta chunks to reasoning chunks for display in the UI
							if (chunk.delta.thinking) {
								yield {
									type: "reasoning",
									reasoning: chunk.delta.thinking,
								}
								// Also yield the original thinking_delta chunk for internal use
								yield {
									type: "thinking_delta",
									thinking: chunk.delta.thinking,
								}
							}
							break
						case "signature_delta":
							if (chunk.delta.signature) {
								yield {
									type: "signature_delta",
									signature: chunk.delta.signature,
								}
							}
							break
					}
					break
			}
		}
	}

	getModel(): { id: BedrockModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bedrockModels) {
			const id = modelId as BedrockModelId
			return { id, info: bedrockModels[id] }
		}
		return {
			id: bedrockDefaultModelId,
			info: bedrockModels[bedrockDefaultModelId],
		}
	}

	private async getClient(): Promise<AnthropicBedrock> {
		// Create AWS credentials by executing a an AWS provider chain exactly as the
		// Anthropic SDK does it, by wrapping the default chain into a temporary process
		// environment.
		const providerChain = fromNodeProviderChain()
		const credentials = await AwsBedrockHandler.withTempEnv(
			() => {
				AwsBedrockHandler.setEnv("AWS_REGION", this.options.awsRegion)
				AwsBedrockHandler.setEnv("AWS_ACCESS_KEY_ID", this.options.awsAccessKey)
				AwsBedrockHandler.setEnv("AWS_SECRET_ACCESS_KEY", this.options.awsSecretKey)
				AwsBedrockHandler.setEnv("AWS_SESSION_TOKEN", this.options.awsSessionToken)
				AwsBedrockHandler.setEnv("AWS_PROFILE", this.options.awsProfile)
			},
			() => providerChain(),
		)

		// Return an AnthropicBedrock client with the resolved/assumed credentials.
		//
		// When AnthropicBedrock creates its AWS client, the chain will execute very
		// fast as the access/secret keys will already be already provided, and have
		// a higher precedence than the profiles.
		return new AnthropicBedrock({
			awsAccessKey: credentials.accessKeyId,
			awsSecretKey: credentials.secretAccessKey,
			awsSessionToken: credentials.sessionToken,
			awsRegion: this.options.awsRegion || "us-east-1",
		})
	}

	private async getModelId(): Promise<string> {
		if (this.options.awsUseCrossRegionInference) {
			let regionPrefix = (this.options.awsRegion || "").slice(0, 3)
			switch (regionPrefix) {
				case "us-":
					return `us.${this.getModel().id}`
				case "eu-":
					return `eu.${this.getModel().id}`
					break
				default:
					// cross region inference is not supported in this region, falling back to default model
					return this.getModel().id
					break
			}
		}
		return this.getModel().id
	}

	private static async withTempEnv<R>(updateEnv: () => void, fn: () => Promise<R>): Promise<R> {
		const previousEnv = { ...process.env }

		try {
			updateEnv()
			return await fn()
		} finally {
			process.env = previousEnv
		}
	}

	private static async setEnv(key: string, value: string | undefined) {
		if (key !== "" && value !== undefined) {
			process.env[key] = value
		}
	}
}
