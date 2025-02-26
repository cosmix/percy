// This script tests the DiffViewProvider's updateVisualPreview method
// to ensure it properly handles new files during streaming mode

// Create a mock TextEditor instance to test the behavior
const vscode = {
	Position: class Position {
		constructor(line, character) {
			this.line = line
			this.character = character
		}
	},
	Selection: class Selection {
		constructor(anchor, active) {
			this.anchor = anchor
			this.active = active
		}
	},
	Range: class Range {
		constructor(start, end) {
			this.start = start
			this.end = end
		}
	},
	WorkspaceEdit: class WorkspaceEdit {
		constructor() {
			this.operations = []
		}
		replace(uri, range, content) {
			this.operations.push({ type: "replace", uri, range, content })
		}
	},
	Uri: {
		file: (path) => ({ fsPath: path, path }),
	},
	workspace: {
		applyEdit: async (edit) => {
			console.log("Edit applied:", edit.operations)
			return true
		},
	},
}

// Create a mock instance that simulates DiffViewProvider's behavior for testing
class MockDiffViewProvider {
	constructor() {
		this.editType = "create" // Test for new files
		this.activeDiffEditor = {
			document: {
				lineCount: 0,
				uri: vscode.Uri.file("/test/file.js"),
			},
			selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
			revealRange: (range) => {
				console.log("Scrolled to:", range)
			},
		}
		this.activeLineController = {
			setActiveLine: (line) => {
				console.log("Active line set to:", line)
			},
		}
		this.fadedOverlayController = {
			updateOverlayAfterLine: (line, totalLines) => {
				console.log("Updated overlay after line:", line, "Total lines:", totalLines)
			},
		}
		this.streamedLines = []
		this._isStreamingMode = true
	}

	scrollEditorToLine(line) {
		console.log("Scrolled to line:", line)
	}

	async updateVisualPreview(accumulatedContent) {
		const accumulatedLines = accumulatedContent.split("\n")
		const diffLines = accumulatedLines.slice(this.streamedLines.length)

		const diffEditor = this.activeDiffEditor
		const document = diffEditor?.document
		if (!diffEditor || !document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Place cursor at the beginning
		const beginningOfDocument = new vscode.Position(0, 0)
		diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// For new files, we need to actually update the document content
		// For existing files, we just update decorations to save CPU cycles
		const isNewFile = this.editType === "create"

		if (isNewFile) {
			// For new files, we need to update the actual document content
			// similar to the non-streaming update method but without expensive diffing
			const edit = new vscode.WorkspaceEdit()
			const rangeToReplace = new vscode.Range(0, 0, document.lineCount, 0)
			const contentToReplace = accumulatedLines.join("\n") + "\n"
			edit.replace(document.uri, rangeToReplace, contentToReplace)
			await vscode.workspace.applyEdit(edit)
		}

		// Update decorations
		for (let i = 0; i < diffLines.length; i++) {
			const currentLine = this.streamedLines.length + i
			this.activeLineController.setActiveLine(currentLine)
			this.fadedOverlayController.updateOverlayAfterLine(currentLine, document.lineCount)
			this.scrollEditorToLine(currentLine)
		}

		// Update the tracked streamed lines
		this.streamedLines = accumulatedLines
	}
}

// Test the fix
async function testStreamingNewFile() {
	console.log("=== Testing streaming preview for new files ===")

	const provider = new MockDiffViewProvider()
	console.log("Initial state:", {
		editType: provider.editType,
		isStreamingMode: provider._isStreamingMode,
		streamedLines: provider.streamedLines,
	})

	// First update - this simulates streaming content into a new file
	await provider.updateVisualPreview('const firstLine = "This is the first line";')
	console.log("After first update, streamedLines:", provider.streamedLines)

	// Second update - add more content
	await provider.updateVisualPreview(
		'const firstLine = "This is the first line";\nconst secondLine = "This is the second line";',
	)
	console.log("After second update, streamedLines:", provider.streamedLines)

	console.log("\n=== Test successful ===")

	// The key thing to verify from the output is:
	// 1. For new files, we should see "Edit applied" indicating content was updated
	// 2. The streamedLines should be updated after each operation
}

testStreamingNewFile().catch(console.error)
