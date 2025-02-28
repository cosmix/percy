import * as vscode from "vscode"

export class DecorationController {
	private decorationType: vscode.TextEditorDecorationType
	private editor: vscode.TextEditor
	private activeLines: vscode.Range[] = []
	private pendingDecorations: vscode.Range[] = []
	private batchUpdateScheduled = false
	private batchUpdateInterval = 50 // ms

	constructor(type: "fadedOverlay" | "activeLine", editor: vscode.TextEditor) {
		this.editor = editor
		if (type === "fadedOverlay") {
			this.decorationType = vscode.window.createTextEditorDecorationType({
				opacity: "0.5",
			})
		} else if (type === "activeLine") {
			this.decorationType = vscode.window.createTextEditorDecorationType({
				backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
				isWholeLine: true,
			})
		} else {
			throw new Error("Invalid decoration type")
		}
	}

	/**
	 * Adds a decoration to a single line
	 * @param line The line number to add the decoration to
	 */
	addLine(line: number) {
		this.addLines(line, line)
	}

	/**
	 * Adds decorations to a range of lines and schedules a batch update
	 * @param startLine The starting line number
	 * @param endLine The ending line number
	 */
	addLines(startLine: number, endLine: number) {
		// Validate line numbers against document boundaries
		const maxLine = Math.max(0, this.editor.document.lineCount - 1)
		startLine = Math.max(0, Math.min(startLine, maxLine))
		endLine = Math.max(0, Math.min(endLine, maxLine))

		// Add to pending decorations queue
		this.pendingDecorations.push(new vscode.Range(startLine, 0, endLine, 0))
		this.scheduleBatchUpdate()
	}

	/**
	 * Schedules a batch update of decorations to improve performance
	 */
	private scheduleBatchUpdate() {
		if (!this.batchUpdateScheduled) {
			this.batchUpdateScheduled = true
			setTimeout(() => {
				this.applyBatchDecorations()
				this.batchUpdateScheduled = false
			}, this.batchUpdateInterval)
		}
	}

	/**
	 * Applies all pending decorations in a single batch operation
	 */
	private applyBatchDecorations() {
		// Skip if there are no pending decorations or the editor is no longer valid
		if (this.pendingDecorations.length === 0 || !this.editor || !this.editor.document) {
			return
		}

		// Merge adjacent/overlapping ranges for efficiency
		const optimizedRanges = this.mergeRanges(this.pendingDecorations)

		// Apply decorations in one batch
		this.editor.setDecorations(this.decorationType, optimizedRanges)

		// Update active lines tracking
		this.activeLines = [...optimizedRanges]

		// Clear pending decorations
		this.pendingDecorations = []
	}

	/**
	 * Merges adjacent or overlapping ranges to minimize the number of decoration operations
	 * @param ranges The ranges to merge
	 * @returns An optimized array of merged ranges
	 */
	private mergeRanges(ranges: vscode.Range[]): vscode.Range[] {
		// Special handling for empty files
		if (this.editor.document.lineCount === 0) {
			return []
		}

		if (ranges.length <= 1) {
			return [...ranges]
		}

		// Sort ranges by start line
		const sortedRanges = [...ranges].sort((a, b) => a.start.line - b.start.line)
		const mergedRanges: vscode.Range[] = []
		let currentRange = sortedRanges[0]

		for (let i = 1; i < sortedRanges.length; i++) {
			const nextRange = sortedRanges[i]

			// If ranges overlap or are adjacent, merge them
			if (nextRange.start.line <= currentRange.end.line + 1) {
				currentRange = new vscode.Range(
					currentRange.start,
					new vscode.Position(Math.max(currentRange.end.line, nextRange.end.line), nextRange.end.character),
				)
			} else {
				// No overlap, add current range and start a new one
				mergedRanges.push(currentRange)
				currentRange = nextRange
			}
		}

		// Add the last range
		mergedRanges.push(currentRange)
		return mergedRanges
	}

	/**
	 * Sets the active line with batched updates
	 * @param line The line number to set as active
	 */
	batchSetActiveLine(line: number) {
		// Validate line number
		const maxLine = Math.max(0, this.editor.document.lineCount - 1)
		line = Math.max(0, Math.min(line, maxLine))

		// Add to pending decorations
		this.pendingDecorations = [new vscode.Range(line, 0, line, 0)]
		this.scheduleBatchUpdate()
	}

	/**
	 * Updates the faded overlay with batched updates
	 * @param activeLine The active line that should not be faded
	 * @param totalLines The total number of lines in the document
	 */
	batchUpdateOverlay(activeLine: number, totalLines: number) {
		// Validate line numbers
		const maxLine = Math.max(0, this.editor.document.lineCount - 1)
		activeLine = Math.max(0, Math.min(activeLine, maxLine))
		totalLines = Math.max(0, Math.min(totalLines, maxLine + 1))

		// Create ranges for all lines except the active line
		this.pendingDecorations = []

		// Add range before active line if any
		if (activeLine > 0) {
			this.pendingDecorations.push(new vscode.Range(0, 0, activeLine - 1, 0))
		}

		// Add range after active line if any
		if (activeLine < totalLines - 1) {
			this.pendingDecorations.push(new vscode.Range(activeLine + 1, 0, totalLines - 1, 0))
		}

		this.scheduleBatchUpdate()
	}

	/**
	 * Batch adds lines to the faded overlay
	 * @param startLine The starting line number
	 * @param endLine The ending line number
	 */
	batchAddLines(startLine: number, endLine: number) {
		// Validate line numbers
		const maxLine = Math.max(0, this.editor.document.lineCount - 1)
		startLine = Math.max(0, Math.min(startLine, maxLine))
		endLine = Math.max(0, Math.min(endLine, maxLine))

		// Add to pending decorations
		this.pendingDecorations.push(new vscode.Range(startLine, 0, endLine, 0))
		this.scheduleBatchUpdate()
	}

	/**
	 * Clears all decorations
	 */
	clear() {
		this.editor.setDecorations(this.decorationType, [])
		this.activeLines = []
		this.pendingDecorations = []
	}

	/**
	 * Disposes the decoration type
	 */
	dispose() {
		this.decorationType.dispose()
	}
}
