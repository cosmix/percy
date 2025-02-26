import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../../../src/shared/ExtensionMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()

	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
			}}>
			<div
				style={{
					height: "100%",
					padding: "0 20px",
					overflow: "auto",
				}}>
				<h2>Hi, I'm Percy</h2>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in Claude 3.7 Sonnet's agentic coding capabilities and
					access to tools that let me create & edit files, explore complex projects, use the browser, and execute
					terminal commands (with your permission, of course). I can even use MCP to create new tools and extend my own
					capabilities.
				</p>

				<b>To get started, this extension needs an API provider for Claude 3.7 Sonnet.</b>

				<div style={{ marginTop: "15px" }}>
					<ApiOptions showModelOptions={false} />
					<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
						Let's go!
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default WelcomeView
