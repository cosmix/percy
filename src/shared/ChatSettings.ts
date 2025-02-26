import { ApiConfiguration } from "./api"

export interface ChatSettings {
	mode: "plan" | "act"
	planModeConfiguration?: ApiConfiguration
	actModeConfiguration?: ApiConfiguration
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	mode: "act",
	planModeConfiguration: undefined,
	actModeConfiguration: undefined,
}
