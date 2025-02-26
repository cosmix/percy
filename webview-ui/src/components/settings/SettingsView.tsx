import { VSCodeButton, VSCodeLink, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration, validateModelId } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "./ApiOptions"
import SettingsButton from "../common/SettingsButton"
const { IS_DEV } = process.env

type SettingsViewProps = {
	onDone: () => void
}

const PLAN_MODE_COLOR = "var(--vscode-inputValidation-warningBorder)"
const ACT_MODE_COLOR = "var(--vscode-inputValidation-warningBorder)"

const ModeIndicator = styled.div<{ mode: "plan" | "act" }>`
	display: inline-flex;
	align-items: center;
	padding: 3px 8px;
	border-radius: 3px;
	font-size: 12px;
	font-weight: 500;
	margin-left: 10px;
	background-color: ${(props) =>
		props.mode === "plan"
			? "color-mix(in srgb, " + PLAN_MODE_COLOR + " 15%, transparent)"
			: "color-mix(in srgb, " + ACT_MODE_COLOR + " 15%, transparent)"};
	color: ${(props) => (props.mode === "plan" ? PLAN_MODE_COLOR : ACT_MODE_COLOR)};
	border: 1px solid ${(props) => (props.mode === "plan" ? PLAN_MODE_COLOR : ACT_MODE_COLOR)};
`

const SettingsView = ({ onDone }: SettingsViewProps) => {
	const { apiConfiguration, version, customInstructions, setCustomInstructions, openRouterModels, chatSettings } =
		useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = () => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

		setApiErrorMessage(apiValidationResult)
		setModelIdErrorMessage(modelIdValidationResult)

		if (!apiValidationResult && !modelIdValidationResult) {
			vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			vscode.postMessage({
				type: "customInstructions",
				text: customInstructions,
			})
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
		setModelIdErrorMessage(undefined)
	}, [apiConfiguration])

	// validate as soon as the component is mounted
	/*
	useEffect will use stale values of variables if they are not included in the dependency array. so trying to use useEffect with a dependency array of only one value for example will use any other variables' old values. In most cases you don't want this, and should opt to use react-use hooks.
	
	useEffect(() => {
		// uses someVar and anotherVar
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [someVar])

	If we only want to run code once on mount we can use react-use's useEffectOnce or useMount
	*/

	const handleResetState = () => {
		vscode.postMessage({ type: "resetState" })
	}

	const toggleMode = () => {
		const newMode = chatSettings.mode === "plan" ? "act" : "plan"
		vscode.postMessage({
			type: "togglePlanActMode",
			chatSettings: {
				mode: newMode,
			},
		})
	}

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "10px 0px 0px 20px",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "17px",
					paddingRight: 17,
				}}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>
						<ModeIndicator mode={chatSettings.mode}>{chatSettings.mode === "plan" ? "PLAN" : "ACT"}</ModeIndicator>
						<span style={{ marginLeft: ".5rem" }}>Mode Profile</span>
					</h3>
				</div>
				<div style={{ display: "flex", gap: "8px" }}>
					<VSCodeButton appearance="secondary" onClick={toggleMode}>
						Switch to {chatSettings.mode === "plan" ? "Act" : "Plan"} Mode
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						onClick={() => {
							// Copy current configuration to the other mode
							const sourceConfig = { ...apiConfiguration }
							const targetMode = chatSettings.mode === "plan" ? "act" : "plan"

							// Create updated chat settings with the copied configuration
							const updatedChatSettings = { ...chatSettings }
							if (targetMode === "plan") {
								updatedChatSettings.planModeConfiguration = sourceConfig
							} else {
								updatedChatSettings.actModeConfiguration = sourceConfig
							}

							// Update the chat settings
							vscode.postMessage({
								type: "togglePlanActMode",
								chatSettings: updatedChatSettings,
							})

							// Show a brief notification in the UI
							// We can't directly show VS Code notifications from the webview
							// so we'll just update the settings and let the user know through the UI change
						}}>
						Copy to {chatSettings.mode === "plan" ? "Act" : "Plan"} Mode
					</VSCodeButton>
					<VSCodeButton onClick={handleSubmit}>Done</VSCodeButton>
				</div>
			</div>
			<div
				style={{
					flexGrow: 1,
					overflowY: "scroll",
					paddingRight: 8,
					display: "flex",
					flexDirection: "column",
				}}>
				<div style={{ marginBottom: 5 }}>
					<ApiOptions
						showModelOptions={true}
						apiErrorMessage={apiErrorMessage}
						modelIdErrorMessage={modelIdErrorMessage}
					/>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Each mode (Plan and Act) can have its own model configuration. Use the buttons above to switch between
						modes or copy settings.
					</p>
				</div>

				<div style={{ marginBottom: 5 }}>
					<VSCodeTextArea
						value={customInstructions ?? ""}
						style={{ width: "100%" }}
						resize="vertical"
						rows={4}
						placeholder={'e.g. "Run unit tests at the end", "Use TypeScript with async/await", "Speak in Spanish"'}
						onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
						<span style={{ fontWeight: "500" }}>Custom Instructions</span>
					</VSCodeTextArea>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						These instructions are added to the end of the system prompt sent with every request.
					</p>
				</div>

				{IS_DEV && (
					<>
						<div style={{ marginTop: "10px", marginBottom: "4px" }}>Debug</div>
						<VSCodeButton onClick={handleResetState} style={{ marginTop: "5px", width: "auto" }}>
							Reset State
						</VSCodeButton>
						<p
							style={{
								fontSize: "12px",
								marginTop: "5px",
								color: "var(--vscode-descriptionForeground)",
							}}>
							This will reset all global state and secret storage in the extension.
						</p>
					</>
				)}

				<div
					style={{
						marginTop: "auto",
						paddingRight: 8,
						display: "flex",
						justifyContent: "center",
					}}>
					<SettingsButton
						onClick={() => vscode.postMessage({ type: "openExtensionSettings" })}
						style={{
							margin: "0 0 16px 0",
						}}>
						<i className="codicon codicon-settings-gear" />
						Advanced Settings
					</SettingsButton>
				</div>
				<div
					style={{
						textAlign: "center",
						color: "var(--vscode-descriptionForeground)",
						fontSize: "12px",
						lineHeight: "1.2",
						padding: "0 8px 15px 0",
					}}>
					<p
						style={{
							wordWrap: "break-word",
							margin: 0,
							padding: 0,
						}}>
						If you have any questions or feedback, feel free to open an issue at{" "}
						<VSCodeLink href="https://github.com/cline/cline" style={{ display: "inline" }}>
							https://github.com/cline/cline
						</VSCodeLink>
					</p>
					<p
						style={{
							fontStyle: "italic",
							margin: "10px 0 0 0",
							padding: 0,
						}}>
						v{version}
					</p>
				</div>
			</div>
		</div>
	)
}

export default memo(SettingsView)
