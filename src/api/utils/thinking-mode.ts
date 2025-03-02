import { ModelInfo, ThinkingModeOptions } from "../../shared/api"

/**
 * Determines if thinking mode should be enabled for a given model and options.
 * @param modelInfo The model information
 * @param options The thinking mode options
 * @returns True if thinking mode should be enabled, false otherwise
 */
export function isThinkingEnabled(modelInfo: ModelInfo, options?: ThinkingModeOptions): boolean {
	return !!modelInfo.supportsThinking && !!options?.enabled
}

/**
 * Gets the thinking budget tokens, ensuring it doesn't exceed the max tokens.
 * @param modelInfo The model information
 * @param options The thinking mode options
 * @param maxTokens The maximum tokens allowed (optional)
 * @returns The thinking budget tokens, or 0 if thinking is not enabled
 */
export function getThinkingBudget(modelInfo: ModelInfo, options?: ThinkingModeOptions, maxTokens?: number): number {
	if (!isThinkingEnabled(modelInfo, options)) {
		return 0
	}

	return Math.min(options?.budgetTokens || 0, maxTokens || modelInfo.maxTokens || Infinity)
}

/**
 * Gets the appropriate temperature for thinking mode.
 * Currently, all thinking-capable models use temperature=1.0 when thinking is enabled.
 * @param modelInfo The model information
 * @param options The thinking mode options
 * @returns The temperature to use for thinking mode, or undefined if thinking is not enabled
 */
export function getThinkingTemperature(modelInfo: ModelInfo, options?: ThinkingModeOptions): number | undefined {
	if (!isThinkingEnabled(modelInfo, options)) {
		return 0 // Default temperature for non-thinking responses
	}

	// For now, all thinking-enabled models need temperature=1
	// This could be made more specific in the future if needed
	return 1.0
}
