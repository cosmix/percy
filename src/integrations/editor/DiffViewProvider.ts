import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../../core/prompts/responses"
import { DecorationController } from "./DecorationController"
import * as diff from "diff"
import { diagnosticsToProblemsString, getNewDiagnostics } from "../diagnostics"
import { constructNewFileContent } from "../../core/assistant-message/diff"

export const DIFF_VIEW_URI_SCHEME = "cline-diff"

export class DiffViewProvider {
	editType?: "create" | "modify"
	isEditing = false
	originalContent: string | undefined
	private createdDirs: string[] = []
	private documentWasOpen = false
	private relPath?: string
	private newContent?: string
	private activeDiffEditor?: vscode.TextEditor
	private fadedOverlayController?: DecorationController
	private activeLineController?: DecorationController
	private streamedLines: string[] = []
	private preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []
	private bufferedContent: string | undefined
	private _isStreamingMode: boolean = false
	private lastProcessedContent: string = ""

	// Public getter for streaming mode state
	get isStreamingMode(): boolean {
		return this._isStreamingMode
	}

	constructor(private cwd: string) {}

	async open(relPath: string, streamingMode: boolean = false): Promise<void> {
		this._isStreamingMode = streamingMode
		this.bufferedContent = undefined
		this.lastProcessedContent = ""
		this.relPath = relPath
		const fileExists = this.editType === "modify"
		const absolutePath = path.resolve(this.cwd, relPath)
		this.isEditing = true
		// if the file is already open, ensure it's not dirty before getting its contents
		if (fileExists) {
			const existingDocument = vscode.workspace.textDocuments.find((doc) => arePathsEqual(doc.uri.fsPath, absolutePath))
			if (existingDocument && existingDocument.isDirty) {
				await existingDocument.save()
			}
		}

		// get diagnostics before editing the file, we'll compare to diagnostics after editing to see if cline needs to fix anything
		this.preDiagnostics = vscode.languages.getDiagnostics()

		if (fileExists) {
			this.originalContent = await fs.readFile(absolutePath, "utf-8")
		} else {
			this.originalContent = ""
		}
		// for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation
		this.createdDirs = await createDirectoriesForFile(absolutePath)
		// make sure the file exists before we open it
		if (!fileExists) {
			await fs.writeFile(absolutePath, "")
		}
		// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
		this.documentWasOpen = false
		// close the tab if it's open (it's already saved above)
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter((tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, absolutePath))
		for (const tab of tabs) {
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
			this.documentWasOpen = true
		}

		this.activeDiffEditor = await this.openDiffEditor()
		this.fadedOverlayController = new DecorationController("fadedOverlay", this.activeDiffEditor)
		this.activeLineController = new DecorationController("activeLine", this.activeDiffEditor)

		// Apply faded overlay to all lines initially using batch operations
		if (this.activeDiffEditor.document.lineCount > 0) {
			this.fadedOverlayController.batchAddLines(0, this.activeDiffEditor.document.lineCount)
		}

		// Safely scroll to the beginning
		this.scheduleScrollUpdate(0)
		this.streamedLines = []
	}

	/**
	 * Updates the document content with the accumulated content.
	 * In streaming mode, it defers expensive operations until the final update.
	 * Updates are applied in chunks to show progress while maintaining performance.
	 */
	async update(accumulatedContent: string, isFinal: boolean) {
		if (!this.relPath || !this.activeLineController || !this.fadedOverlayController) {
			throw new Error("Required values not set")
		}

		if (this.isStreamingMode) {
			// Always update the buffered content
			this.bufferedContent = accumulatedContent

			if (!isFinal) {
				// In streaming mode with non-final update, just update visual display
				await this.updateVisualPreview(accumulatedContent)
				return
			}
			// For final update in streaming mode, fall through to perform the actual diff
			// with the complete buffered content
		}

		// For final update or non-streaming mode, perform the actual diff
		this.newContent = accumulatedContent
		const accumulatedLines = accumulatedContent.split("\n")
		if (!isFinal) {
			accumulatedLines.pop() // remove the last partial line only if it's not the final update
		}
		const diffLines = accumulatedLines.slice(this.streamedLines.length)

		const diffEditor = this.activeDiffEditor
		const document = diffEditor?.document
		if (!diffEditor || !document) {
			throw new Error("User closed text editor, unable to edit file...")
		}

		// Place cursor at the beginning of the diff editor to keep it out of the way of the stream animation
		const beginningOfDocument = new vscode.Position(0, 0)
		diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

		// Process updates in chunks of 5-6 lines for better performance while still showing progress
		const CHUNK_SIZE = 5 // Process 5 lines at a time

		for (let i = 0; i < diffLines.length; i += CHUNK_SIZE) {
			// Calculate the chunk end (capped at diffLines.length)
			const chunkEnd = Math.min(i + CHUNK_SIZE, diffLines.length)
			const currentChunkSize = chunkEnd - i

			// Calculate the current line after applying this chunk
			const currentLine = this.streamedLines.length + chunkEnd - 1

			// Replace all content up to the current line with accumulated lines
			const edit = new vscode.WorkspaceEdit()
			const rangeToReplace = new vscode.Range(0, 0, currentLine + 1, 0)
			const contentToReplace = accumulatedLines.slice(0, currentLine + 1).join("\n") + "\n"
			edit.replace(document.uri, rangeToReplace, contentToReplace)
			await vscode.workspace.applyEdit(edit)

			// Update decorations using batch operations
			this.activeLineController.batchSetActiveLine(currentLine)
			this.fadedOverlayController.batchUpdateOverlay(currentLine, document.lineCount)

			// Schedule scrolling to the current line
			this.scheduleScrollUpdate(currentLine)

			// Update the tracked streamed lines for this chunk
			this.streamedLines = accumulatedLines.slice(0, currentLine + 1)
		}

		// Update the final streamedLines with the complete accumulated content
		this.streamedLines = accumulatedLines

		if (isFinal) {
			// Handle any remaining lines if the new content is shorter than the original
			if (this.streamedLines.length < document.lineCount) {
				const edit = new vscode.WorkspaceEdit()
				edit.delete(document.uri, new vscode.Range(this.streamedLines.length, 0, document.lineCount, 0))
				await vscode.workspace.applyEdit(edit)
			}

			// Add empty last line if original content had one
			const hasEmptyLastLine = this.originalContent?.endsWith("\n")
			if (hasEmptyLastLine) {
				const accumulatedLines = accumulatedContent.split("\n")
				if (accumulatedLines[accumulatedLines.length - 1] !== "") {
					accumulatedContent += "\n"
				}
			}

			// Clear all decorations at the end (before applying final edit)
			this.fadedOverlayController.clear()
			this.activeLineController.clear()
		}
	}

	async saveChanges(): Promise<{
		newProblemsMessage: string | undefined
		userEdits: string | undefined
		autoFormattingEdits: string | undefined
		finalContent: string | undefined
	}> {
		if (!this.relPath || !this.newContent || !this.activeDiffEditor) {
			return {
				newProblemsMessage: undefined,
				userEdits: undefined,
				autoFormattingEdits: undefined,
				finalContent: undefined,
			}
		}
		const absolutePath = path.resolve(this.cwd, this.relPath)
		const updatedDocument = this.activeDiffEditor.document

		// get the contents before save operation which may do auto-formatting
		const preSaveContent = updatedDocument.getText()

		if (updatedDocument.isDirty) {
			await updatedDocument.save()
		}

		// await delay(100)
		// get text after save in case there is any auto-formatting done by the editor
		const postSaveContent = updatedDocument.getText()

		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
			preview: false,
		})
		await this.closeAllDiffViews()

		/*
		Getting diagnostics before and after the file edit is a better approach than
		automatically tracking problems in real-time. This method ensures we only
		report new problems that are a direct result of this specific edit.
		Since these are new problems resulting from Percy's edit, we know they're
		directly related to the work he's doing. This eliminates the risk of Percy
		going off-task or getting distracted by unrelated issues, which was a problem
		with the previous auto-debug approach. Some users' machines may be slow to
		update diagnostics, so this approach provides a good balance between automation
		and avoiding potential issues where Percy might get stuck in loops due to
		outdated problem information. If no new problems show up by the time the user
		accepts the changes, they can always debug later using the '@problems' mention.
		This way, Percy only becomes aware of new problems resulting from his edits
		and can address them accordingly. If problems don't change immediately after
		applying a fix, Percy won't be notified, which is generally fine since the
		initial fix is usually correct and it may just take time for linters to catch up.
		*/
		const postDiagnostics = vscode.languages.getDiagnostics()
		const newProblems = diagnosticsToProblemsString(
			getNewDiagnostics(this.preDiagnostics, postDiagnostics),
			[
				vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
			],
			this.cwd,
		) // will be empty string if no errors
		const newProblemsMessage =
			newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

		/**
		 * Normalize line endings in a string to a consistent format
		 */
		function normalizeLineEndings(content: string, targetEOL: string): string {
			// First convert all to LF
			const lfOnly = content.replace(/\r\n/g, "\n")
			// Then convert to target EOL if not LF
			return targetEOL === "\n" ? lfOnly : lfOnly.replace(/\n/g, targetEOL)
		}

		// Determine the dominant line ending in the content
		const dominantEOL = (content: string): string => {
			const crlfCount = (content.match(/\r\n/g) || []).length
			const lfCount = (content.match(/(?<!\r)\n/g) || []).length
			return crlfCount > lfCount ? "\r\n" : "\n"
		}

		// If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
		const newContentEOL = dominantEOL(this.newContent)
		const normalizedPreSaveContent = normalizeLineEndings(preSaveContent, newContentEOL).trimEnd() + newContentEOL // trimEnd to fix issue where editor adds in extra new line automatically
		const normalizedPostSaveContent = normalizeLineEndings(postSaveContent, newContentEOL).trimEnd() + newContentEOL // this is the final content we return to the model to use as the new baseline for future edits
		// just in case the new content has a mix of varying EOL characters
		const normalizedNewContent = normalizeLineEndings(this.newContent, newContentEOL).trimEnd() + newContentEOL

		let userEdits: string | undefined
		if (normalizedPreSaveContent !== normalizedNewContent) {
			// user made changes before approving edit. let the model know about user made changes (not including post-save auto-formatting changes)
			userEdits = formatResponse.createPrettyPatch(this.relPath.toPosix(), normalizedNewContent, normalizedPreSaveContent)
			// return { newProblemsMessage, userEdits, finalContent: normalizedPostSaveContent }
		} else {
			// no changes to cline's edits
			// return { newProblemsMessage, userEdits: undefined, finalContent: normalizedPostSaveContent }
		}

		let autoFormattingEdits: string | undefined
		if (normalizedPreSaveContent !== normalizedPostSaveContent) {
			// auto-formatting was done by the editor
			autoFormattingEdits = formatResponse.createPrettyPatch(
				this.relPath.toPosix(),
				normalizedPreSaveContent,
				normalizedPostSaveContent,
			)
		}

		return {
			newProblemsMessage,
			userEdits,
			autoFormattingEdits,
			finalContent: normalizedPostSaveContent,
		}
	}

	async revertChanges(): Promise<void> {
		if (!this.relPath || !this.activeDiffEditor) {
			return
		}
		const fileExists = this.editType === "modify"
		const updatedDocument = this.activeDiffEditor.document
		const absolutePath = path.resolve(this.cwd, this.relPath)
		if (!fileExists) {
			if (updatedDocument.isDirty) {
				await updatedDocument.save()
			}
			await this.closeAllDiffViews()
			await fs.unlink(absolutePath)

			// Remove only the directories we created, in reverse order
			for (let i = this.createdDirs.length - 1; i >= 0; i--) {
				try {
					// Check if directory is empty first
					const dirContents = await fs.readdir(this.createdDirs[i])
					if (dirContents.length === 0) {
						await fs.rmdir(this.createdDirs[i])
						console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
					} else {
						console.log(`Directory ${this.createdDirs[i]} not empty, skipping removal.`)
					}
				} catch (error) {
					console.warn(`Failed to remove directory ${this.createdDirs[i]}:`, error)
				}
			}
			console.log(`File ${absolutePath} has been deleted.`)
		} else {
			// revert document

			const edit = new vscode.WorkspaceEdit()
			const fullRange = new vscode.Range(
				new vscode.Position(0, 0),
				updatedDocument.lineCount > 0
					? updatedDocument.lineAt(updatedDocument.lineCount - 1).range.end
					: new vscode.Position(0, 0),
			)
			edit.replace(updatedDocument.uri, fullRange, this.originalContent ?? "")
			// Apply the edit and save, since contents shouldnt have changed this wont show in local history unless of course the user made changes and saved during the edit
			await vscode.workspace.applyEdit(edit)
			await updatedDocument.save()
			console.log(`File ${absolutePath} has been reverted to its original content.`)
			if (this.documentWasOpen) {
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
					preview: false,
				})
			}
			await this.closeAllDiffViews()
		}

		// edit is done
		await this.reset()
	}

	private async closeAllDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.flatMap((tg) => tg.tabs)
			.filter((tab) => tab.input instanceof vscode.TabInputTextDiff && tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME)
		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
		}
	}

	private async openDiffEditor(): Promise<vscode.TextEditor> {
		if (!this.relPath) {
			throw new Error("No file path set")
		}
		const uri = vscode.Uri.file(path.resolve(this.cwd, this.relPath))

		// Try to find an existing diff tab
		const diffTab = vscode.window.tabGroups.all
			.flatMap((group) => group.tabs)
			.find(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff &&
					tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME &&
					arePathsEqual(tab.input.modified.fsPath, uri.fsPath),
			)

		if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
			try {
				const editor = await vscode.window.showTextDocument(diffTab.input.modified)
				return editor
			} catch (error) {
				console.error("Failed to show existing diff editor:", error)
				// Fall through to open a new one
			}
		}

		// Open new diff editor with proper tracking and timeouts
		return new Promise<vscode.TextEditor>((resolve, reject) => {
			const fileName = path.basename(uri.fsPath)
			const fileExists = this.editType === "modify"

			// Keep track of whether we've handled the editor change
			let handled = false

			const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (!handled && editor && arePathsEqual(editor.document.uri.fsPath, uri.fsPath)) {
					handled = true
					disposable.dispose()
					clearTimeout(timeoutHandle)
					resolve(editor)
				}
			})

			// Execute the command to open the diff view
			vscode.commands
				.executeCommand(
					"vscode.diff",
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
						query: Buffer.from(this.originalContent ?? "").toString("base64"),
					}),
					uri,
					`${fileName}: ${fileExists ? "Original ↔ Percy's Changes" : "New File"} (Editable)`,
				)
				.then(null, (err) => {
					if (!handled) {
						handled = true
						disposable.dispose()
						clearTimeout(timeoutHandle)
						reject(new Error(`Failed to execute diff command: ${err}`))
					}
				})

			// Set a timeout with proper cleanup
			const timeoutHandle = setTimeout(() => {
				if (!handled) {
					handled = true
					disposable.dispose()
					reject(new Error("Failed to open diff editor, timeout exceeded"))
				}
			}, 10_000)
		})
	}

	private scrollEditorToLine(line: number) {
		if (this.activeDiffEditor) {
			const scrollLine = line + 4
			this.activeDiffEditor.revealRange(
				new vscode.Range(scrollLine, 0, scrollLine, 0),
				vscode.TextEditorRevealType.InCenter,
			)
		}
	}

	// Throttled scrolling mechanism with improved edge case handling
	private scrollTargetLine = 0
	private scrollUpdateScheduled = false
	private scrollThrottleInterval = 100 // ms

	private scheduleScrollUpdate(line: number) {
		// Validate line number to prevent negative values
		const newTargetLine = Math.max(0, line)

		// Only schedule if the target has changed
		if (this.scrollTargetLine !== newTargetLine) {
			this.scrollTargetLine = newTargetLine

			// Throttle updates to reduce UI jitter and improve performance
			if (!this.scrollUpdateScheduled) {
				this.scrollUpdateScheduled = true
				setTimeout(() => {
					// Store current target line before resetting flag
					const currentTarget = this.scrollTargetLine
					this.scrollUpdateScheduled = false

					// Use the most recent target line when the timeout executes
					this.scrollEditorToLine(currentTarget)
				}, this.scrollThrottleInterval)
			}
		}
	}

	/**
	 * Optimized visual preview that minimizes document updates and batches UI changes
	 * This is used during streaming to provide a visual approximation without expensive operations
	 */
	private async updateVisualPreview(accumulatedContent: string) {
		try {
			const diffEditor = this.activeDiffEditor
			const document = diffEditor?.document
			if (!diffEditor || !document) {
				throw new Error("User closed text editor, unable to edit file...")
			}

			// Place cursor at the beginning to keep it out of the way
			const beginningOfDocument = new vscode.Position(0, 0)
			diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

			// For new files, always replace the entire content to ensure nothing is missed
			// This is a more reliable approach for new files
			if (this.editType === "create") {
				// Create a range that covers the entire document
				const fullRange = new vscode.Range(
					new vscode.Position(0, 0),
					document.lineCount > 0 ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(0, 0),
				)

				// Apply a single edit with the full accumulated content
				const edit = new vscode.WorkspaceEdit()
				edit.replace(document.uri, fullRange, accumulatedContent)
				await vscode.workspace.applyEdit(edit)

				// Update the tracked streamed lines
				this.streamedLines = accumulatedContent.split("\n")

				// Use batch updates for decorations
				const lastLine = Math.max(0, this.streamedLines.length - 1)
				this.activeLineController?.batchSetActiveLine(lastLine)
				this.fadedOverlayController?.batchUpdateOverlay(lastLine, document.lineCount)

				// Schedule scrolling update
				this.scheduleScrollUpdate(lastLine)
				return
			}

			// For existing files, use an incremental approach to show streaming content
			// This provides better visual feedback during streaming
			if (this.originalContent && this.editType === "modify") {
				// Only process the new content since the last update
				const newContent = accumulatedContent.substring(this.lastProcessedContent.length)
				if (!newContent) {
					return
				} // No new content to process

				// Update our tracking of processed content
				this.lastProcessedContent = accumulatedContent

				// Process the accumulated content in chunks to show progress
				const accumulatedLines = accumulatedContent.split("\n")
				const currentLines = document.getText().split("\n")

				// Calculate how many lines we need to update
				const linesToUpdate = Math.max(0, accumulatedLines.length - currentLines.length)

				if (linesToUpdate > 0 || accumulatedLines.length !== currentLines.length) {
					// Use the lightweight preview function for a more accurate diff
					// but still show incremental updates
					const previewContent = await constructNewFileContent(
						accumulatedContent,
						this.originalContent,
						false, // not final
						true, // defer matching
					)

					// Create a range that covers the entire document
					const fullRange = new vscode.Range(
						new vscode.Position(0, 0),
						document.lineCount > 0 ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(0, 0),
					)

					// Apply the preview content
					const edit = new vscode.WorkspaceEdit()
					edit.replace(document.uri, fullRange, previewContent)
					await vscode.workspace.applyEdit(edit)

					// Update the tracked streamed lines
					this.streamedLines = previewContent.split("\n")

					// Use batch updates for decorations
					const lastLine = Math.max(0, this.streamedLines.length - 1)
					this.activeLineController?.batchSetActiveLine(lastLine)
					this.fadedOverlayController?.batchUpdateOverlay(lastLine, document.lineCount)

					// Schedule scrolling update to follow the content
					this.scheduleScrollUpdate(lastLine)
				}
				return
			}

			// Fallback for any other case - incremental line-by-line updates
			const accumulatedLines = accumulatedContent.split("\n")
			const diffLines = accumulatedLines.slice(this.streamedLines.length)

			// If no new lines, nothing to update
			if (diffLines.length === 0) {
				return
			}

			// Calculate the minimal range that needs updating
			const startLine = this.streamedLines.length
			const endLine = Math.min(startLine + diffLines.length, document.lineCount)

			// Create a range that covers only the new content
			let rangeToReplace: vscode.Range

			// Handle edge cases for document boundaries
			if (startLine >= document.lineCount) {
				// Appending to the end of the document
				const lastPos =
					document.lineCount > 0 ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(0, 0)
				rangeToReplace = new vscode.Range(lastPos, lastPos)
			} else {
				// Replacing existing content
				const startPos = new vscode.Position(startLine, 0)
				const endPos =
					endLine < document.lineCount
						? new vscode.Position(endLine, 0)
						: document.lineAt(document.lineCount - 1).range.end
				rangeToReplace = new vscode.Range(startPos, endPos)
			}

			// Apply a single edit with just the new content
			const edit = new vscode.WorkspaceEdit()
			const newContent = diffLines.join("\n") + (diffLines.length > 0 ? "\n" : "")
			edit.replace(document.uri, rangeToReplace, newContent)
			await vscode.workspace.applyEdit(edit)

			// Use batch updates for decorations
			const lastLine = this.streamedLines.length + diffLines.length - 1
			this.activeLineController?.batchSetActiveLine(lastLine)
			this.fadedOverlayController?.batchUpdateOverlay(lastLine, document.lineCount)

			// Schedule scrolling update
			this.scheduleScrollUpdate(lastLine)

			// Update the tracked streamed lines
			this.streamedLines = accumulatedLines
		} catch (error) {
			console.error("Error in updateVisualPreview:", error)
			// Fall back to a simpler update method if the optimized one fails
			const diffEditor = this.activeDiffEditor
			const document = diffEditor?.document
			if (diffEditor && document) {
				const edit = new vscode.WorkspaceEdit()
				edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), accumulatedContent)
				await vscode.workspace.applyEdit(edit)
				this.streamedLines = accumulatedContent.split("\n")
			}
		}
	}

	scrollToFirstDiff() {
		if (!this.activeDiffEditor) {
			return
		}
		const currentContent = this.activeDiffEditor.document.getText()
		const diffs = diff.diffLines(this.originalContent || "", currentContent)
		let lineCount = 0
		for (const part of diffs) {
			if (part.added || part.removed) {
				// Found the first diff, scroll to it
				this.activeDiffEditor.revealRange(
					new vscode.Range(lineCount, 0, lineCount, 0),
					vscode.TextEditorRevealType.InCenter,
				)
				return
			}
			if (!part.removed) {
				lineCount += part.count || 0
			}
		}
	}

	/**
	 * Finalize the streamed content when streaming is complete.
	 * This applies the full diff with the complete content.
	 */
	async finalizeStreamedContent() {
		if (this.bufferedContent) {
			try {
				// Now perform the actual diff and update document with the complete content
				// The true parameter indicates this is the final update, which will trigger
				// the full diff processing rather than the lightweight preview
				await this.update(this.bufferedContent, true)

				// Clear decorations at the end
				this.fadedOverlayController?.clear()
				this.activeLineController?.clear()

				// Clean up state
				this.bufferedContent = undefined
				this._isStreamingMode = false
				this.lastProcessedContent = ""
			} catch (error) {
				console.error("Error in finalizeStreamedContent:", error)
				// If there's an error, still clean up state to avoid getting stuck
				this.bufferedContent = undefined
				this._isStreamingMode = false
				this.lastProcessedContent = ""
				throw error // Re-throw to allow proper error handling upstream
			}
		} else if (this.isStreamingMode) {
			// Handle case where bufferedContent might be undefined but we're still in streaming mode
			this._isStreamingMode = false
			this.lastProcessedContent = ""
		}
	}

	// close editor if open?
	async reset() {
		this.editType = undefined
		this.isEditing = false
		this.originalContent = undefined
		this.createdDirs = []
		this.documentWasOpen = false
		this.activeDiffEditor = undefined
		this.fadedOverlayController = undefined
		this.activeLineController = undefined
		this.streamedLines = []
		this.preDiagnostics = []
		this.bufferedContent = undefined
		this._isStreamingMode = false
		this.lastProcessedContent = ""
	}
}
