// Re-export everything from the new modular structure
import { boyerMooreSearch } from "../../utils/string"
import { StringBuilder } from "../../utils/string-builder"

export * from "./diff/types"
export * from "./diff/line-index"
export * from "./diff/matching-strategies"
export * from "./diff/processor"

/**
 * Represents a region in the file that was changed by a SEARCH/REPLACE operation
 */
export interface ChangeRegion {
	startLine: number // Line number where change starts
	endLine: number // Line number where change ends
	startOffset: number // Character offset where change starts
	endOffset: number // Character offset where change ends
}

/**
 * Result of constructNewFileContent containing both the new content and information about changed regions
 */
export interface FileChangeResult {
	content: string
	changedRegions: ChangeRegion[]
}

/**
 * Converts a character offset to a line number in the given content
 */
function getLineNumberFromOffset(content: string, offset: number): number {
	const textUpToOffset = content.slice(0, offset)
	return (textUpToOffset.match(/\n/g) || []).length
}

/**
 * A class that maintains an index of lines in a file for efficient searching.
 * This is particularly useful for large files where we need to find specific
 * lines or patterns quickly without scanning the entire file.
 */
class LineIndex {
	// Maps line content hash to positions array
	private contentToPositions = new Map<string, number[]>()
	// Maps line numbers to byte offsets
	private lineToOffset: number[] = []
	// Original lines for quick access
	private lines: string[] = []
	// File size threshold for using the index (in bytes)
	private static readonly SIZE_THRESHOLD = 1024 * 1024 // 1MB

	/**
	 * Creates a new LineIndex from the given content
	 */
	constructor(content: string) {
		this.buildIndex(content)
	}

	/**
	 * Builds the initial index from the content
	 */
	private buildIndex(content: string): void {
		this.lines = content.split("\n")
		let offset = 0

		for (let i = 0; i < this.lines.length; i++) {
			const line = this.lines[i]
			// Store offset
			this.lineToOffset[i] = offset

			// Hash the line (using the trimmed content as key)
			const key = line.trim()

			// Add to position map
			if (!this.contentToPositions.has(key)) {
				this.contentToPositions.set(key, [])
			}
			this.contentToPositions.get(key)!.push(i)

			// Update offset for next line
			offset += line.length + 1 // +1 for newline
		}

		// Add final offset (end of file)
		this.lineToOffset[this.lines.length] = offset
	}

	/**
	 * Gets all positions where the given line content appears
	 */
	getPositionsForLine(lineContent: string): number[] {
		const key = lineContent.trim()
		return this.contentToPositions.get(key) || []
	}

	/**
	 * Gets the byte offset for a given line number
	 */
	getOffsetForLine(lineNumber: number): number {
		return this.lineToOffset[lineNumber] || 0
	}

	/**
	 * Gets the line at the given line number
	 */
	getLineAt(lineNumber: number): string {
		return this.lines[lineNumber] || ""
	}

	/**
	 * Gets the total number of lines
	 */
	getLineCount(): number {
		return this.lines.length
	}

	/**
	 * Finds potential matches for a block of lines starting from a given position
	 * @param searchLines Array of lines to search for
	 * @param startLinePos Line position to start searching from
	 * @returns Array of potential starting line positions
	 */
	findPotentialMatches(searchLines: string[], startLinePos: number = 0): number[] {
		if (searchLines.length === 0) {
			return [0]
		} // Empty search matches at position 0

		// For single-line searches, just return all positions
		if (searchLines.length === 1) {
			return this.getPositionsForLine(searchLines[0]).filter((pos) => pos >= startLinePos)
		}

		// For multi-line searches, find positions of the first line
		const firstLine = searchLines[0].trim()
		const lastLine = searchLines[searchLines.length - 1].trim()

		// Get all positions of the first line
		const firstLinePositions = this.getPositionsForLine(firstLine).filter((pos) => pos >= startLinePos)

		// Early termination - if no first line matches, return empty array
		if (firstLinePositions.length === 0) {
			return []
		}

		// For efficiency, check if last line exists at expected positions
		const validPositions = firstLinePositions.filter((pos) => {
			const expectedLastLinePos = pos + searchLines.length - 1
			return expectedLastLinePos < this.lines.length && this.lines[expectedLastLinePos].trim() === lastLine
		})

		return validPositions
	}

	/**
	 * Finds the exact match for a block of lines
	 * @param searchLines Array of lines to search for
	 * @param startLinePos Line position to start searching from
	 * @returns [startOffset, endOffset] if found, or null if not found
	 */
	findExactMatch(searchLines: string[], startLinePos: number = 0): [number, number] | null {
		const potentialPositions = this.findPotentialMatches(searchLines, startLinePos)

		for (const pos of potentialPositions) {
			let matches = true

			// Check all lines in the block
			for (let i = 0; i < searchLines.length; i++) {
				if (pos + i >= this.lines.length || this.lines[pos + i].trim() !== searchLines[i].trim()) {
					matches = false
					break
				}
			}

			if (matches) {
				// Calculate exact character positions
				const startOffset = this.getOffsetForLine(pos)
				const endOffset =
					pos + searchLines.length < this.lines.length
						? this.getOffsetForLine(pos + searchLines.length)
						: this.getOffsetForLine(this.lines.length - 1) + this.lines[this.lines.length - 1].length + 1

				return [startOffset, endOffset]
			}
		}

		return null
	}

	/**
	 * Determines if the index should be used based on file size
	 */
	static shouldUseIndex(content: string): boolean {
		return content.length > LineIndex.SIZE_THRESHOLD
	}
}

/**
 * Attempts a line-trimmed fallback match for the given search content in the original content.
 * It tries to match `searchContent` lines against a block of lines in `originalContent` starting
 * from `lastProcessedIndex`. Lines are matched by trimming leading/trailing whitespace and ensuring
 * they are identical afterwards.
 *
 * This implementation uses a hash-based approach to efficiently find potential match positions
 * by only checking positions where the first line of the search content appears in the original content.
 * For large files, it can use the LineIndex for more efficient searching.
 *
 * Returns [matchIndexStart, matchIndexEnd] if found, or false if not found.
 */
function lineTrimmedFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number,
	lineIndex?: LineIndex,
): [number, number] | false {
	// If we have a line index and the file is large enough, use it
	if (lineIndex && LineIndex.shouldUseIndex(originalContent)) {
		const searchLines = searchContent.split("\n")

		// Trim trailing empty line if exists
		if (searchLines.length > 0 && searchLines[searchLines.length - 1] === "") {
			searchLines.pop()
		}

		if (searchLines.length === 0) {
			return false
		}

		// Find the line number where startIndex falls
		let startLineNum = 0
		for (let i = 0; i < lineIndex.getLineCount(); i++) {
			if (lineIndex.getOffsetForLine(i) >= startIndex) {
				startLineNum = i > 0 ? i - 1 : 0
				break
			}
		}

		const match = lineIndex.findExactMatch(searchLines, startLineNum)
		return match ? [match[0], match[1]] : false
	}
	// Split both contents into lines
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")

	// Handle empty content cases
	if (searchLines.length === 0 || originalLines.length === 0) {
		return false
	}

	// Trim trailing empty line if exists (from the trailing \n in searchContent)
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}

	// Handle empty check after potential pop
	if (searchLines.length === 0) {
		return false
	}

	// Find the line number where startIndex falls
	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1 // +1 for \n
		startLineNum++
	}

	// Create a hash map of trimmed original lines for efficient lookup
	// The key is the trimmed line content, the value is an array of line numbers where it appears
	const lineHashMap = new Map<string, number[]>()

	// Populate the hash map with original lines (only for the range we need to search)
	for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
		const trimmedLine = originalLines[i].trim()
		if (!lineHashMap.has(trimmedLine)) {
			lineHashMap.set(trimmedLine, [])
		}
		lineHashMap.get(trimmedLine)!.push(i)
	}

	// Get the first line of search content (trimmed)
	const firstLineTrimmed = searchLines[0].trim()

	// Add early termination for multi-line searches
	if (searchLines.length > 1) {
		const lastLineTrimmed = searchLines[searchLines.length - 1].trim()

		// Check if both first and last lines exist in the file
		const firstLinePositions = lineHashMap.get(firstLineTrimmed) || []

		// If first line doesn't exist, the pattern can't match
		if (firstLinePositions.length === 0) {
			return false
		}

		// Check if any valid pattern exists (first line followed by last line at correct distance)
		let validPatternExists = false
		for (const firstPos of firstLinePositions) {
			const expectedLastPos = firstPos + searchLines.length - 1
			// Check if the expected last line position contains the last line content
			if (expectedLastPos < originalLines.length && originalLines[expectedLastPos].trim() === lastLineTrimmed) {
				validPatternExists = true
				break
			}
		}

		if (!validPatternExists) {
			return false
		}
	}

	// Get potential starting positions from the hash map
	// If the first line doesn't exist in the hash map, there can't be a match
	const potentialStartPositions = lineHashMap.get(firstLineTrimmed) || []

	// Check each potential position in ascending order for a full match
	for (const pos of potentialStartPositions) {
		let matches = true

		// Try to match all search lines from this position
		for (let j = 0; j < searchLines.length; j++) {
			const originalTrimmed = originalLines[pos + j].trim()
			const searchTrimmed = searchLines[j].trim()

			if (originalTrimmed !== searchTrimmed) {
				matches = false
				break
			}
		}

		// If we found a match, calculate the exact character positions
		if (matches) {
			// Find start character index
			let matchStartIndex = 0
			for (let k = 0; k < pos; k++) {
				matchStartIndex += originalLines[k].length + 1 // +1 for \n
			}

			// Find end character index
			let matchEndIndex = matchStartIndex
			for (let k = 0; k < searchLines.length; k++) {
				matchEndIndex += originalLines[pos + k].length + 1 // +1 for \n
			}

			return [matchStartIndex, matchEndIndex]
		}
	}

	return false
}

/**
 * Attempts to match blocks of code by using the first and last lines as anchors.
 * This is a third-tier fallback strategy that helps match blocks where we can identify
 * the correct location by matching the beginning and end, even if the exact content
 * differs slightly.
 *
 * The matching strategy:
 * 1. Only attempts to match blocks of 3 or more lines to avoid false positives
 * 2. Extracts from the search content:
 *    - First line as the "start anchor"
 *    - Last line as the "end anchor"
 * 3. For each position in the original content:
 *    - Checks if the next line matches the start anchor
 *    - If it does, jumps ahead by the search block size
 *    - Checks if that line matches the end anchor
 *    - All comparisons are done after trimming whitespace
 *
 * This approach is particularly useful for matching blocks of code where:
 * - The exact content might have minor differences
 * - The beginning and end of the block are distinctive enough to serve as anchors
 * - The overall structure (number of lines) remains the same
 *
 * For large files, it can use the LineIndex for more efficient searching.
 *
 * @param originalContent - The full content of the original file
 * @param searchContent - The content we're trying to find in the original file
 * @param startIndex - The character index in originalContent where to start searching
 * @param lineIndex - Optional LineIndex for optimized searching in large files
 * @returns A tuple of [startIndex, endIndex] if a match is found, false otherwise
 */
function blockAnchorFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number,
	lineIndex?: LineIndex,
): [number, number] | false {
	// If we have a line index and the file is large enough, use it
	if (lineIndex && LineIndex.shouldUseIndex(originalContent)) {
		const searchLines = searchContent.split("\n")

		// Only use this approach for blocks of 3+ lines
		if (searchLines.length < 3) {
			return false
		}

		// Trim trailing empty line if exists
		if (searchLines.length > 0 && searchLines[searchLines.length - 1] === "") {
			searchLines.pop()
		}

		// Find the line number where startIndex falls
		let startLineNum = 0
		for (let i = 0; i < lineIndex.getLineCount(); i++) {
			if (lineIndex.getOffsetForLine(i) >= startIndex) {
				startLineNum = i > 0 ? i - 1 : 0
				break
			}
		}

		const firstLine = searchLines[0].trim()
		const lastLine = searchLines[searchLines.length - 1].trim()

		// Get all positions of the first line
		const firstLinePositions = lineIndex.getPositionsForLine(firstLine).filter((pos) => pos >= startLineNum)

		for (const pos of firstLinePositions) {
			const expectedLastLinePos = pos + searchLines.length - 1

			// Check if last line matches at the expected position
			if (expectedLastLinePos < lineIndex.getLineCount() && lineIndex.getLineAt(expectedLastLinePos).trim() === lastLine) {
				// Calculate exact character positions
				const startOffset = lineIndex.getOffsetForLine(pos)
				const endOffset = lineIndex.getOffsetForLine(expectedLastLinePos + 1)

				return [startOffset, endOffset]
			}
		}

		return false
	}
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")

	// Only use this approach for blocks of 3+ lines
	if (searchLines.length < 3) {
		return false
	}

	// Trim trailing empty line if exists
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}

	const firstLineSearch = searchLines[0].trim()
	const lastLineSearch = searchLines[searchLines.length - 1].trim()
	const searchBlockSize = searchLines.length

	// Find the line number where startIndex falls
	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1
		startLineNum++
	}

	// Look for matching start and end anchors
	for (let i = startLineNum; i <= originalLines.length - searchBlockSize; i++) {
		// Check if first line matches
		if (originalLines[i].trim() !== firstLineSearch) {
			continue
		}

		// Check if last line matches at the expected position
		if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) {
			continue
		}

		// Calculate exact character positions
		let matchStartIndex = 0
		for (let k = 0; k < i; k++) {
			matchStartIndex += originalLines[k].length + 1
		}

		let matchEndIndex = matchStartIndex
		for (let k = 0; k < searchBlockSize; k++) {
			matchEndIndex += originalLines[i + k].length + 1
		}

		return [matchStartIndex, matchEndIndex]
	}

	return false
}

/**
 * This function reconstructs the file content by applying a streamed diff (in a
 * specialized SEARCH/REPLACE block format) to the original file content. It is designed
 * to handle both incremental updates and the final resulting file after all chunks have
 * been processed.
 *
 * The diff format is a custom structure that uses three markers to define changes:
 *
 *   <<<<<<< SEARCH
 *   [Exact content to find in the original file]
 *   =======
 *   [Content to replace with]
 *   >>>>>>> REPLACE
 *
 * Behavior and Assumptions:
 * 1. The file is processed chunk-by-chunk. Each chunk of `diffContent` may contain
 *    partial or complete SEARCH/REPLACE blocks. By calling this function with each
 *    incremental chunk (with `isFinal` indicating the last chunk), the final reconstructed
 *    file content is produced.
 *
 * 2. Matching Strategy (in order of attempt):
 *    a. Exact Match: First attempts to find the exact SEARCH block text in the original file
 *    b. Line-Trimmed Match: Falls back to line-by-line comparison ignoring leading/trailing whitespace
 *    c. Block Anchor Match: For blocks of 3+ lines, tries to match using first/last lines as anchors
 *    If all matching strategies fail, an error is thrown.
 *
 * 3. Edge Case Handling:
 *    - Empty SEARCH and Empty REPLACE: The block is skipped entirely (no changes made).
 *    - Empty SEARCH, Non-empty REPLACE:
 *      * For empty files: Creates a new file with the REPLACE content.
 *      * For non-empty files: Replaces the entire file content with the REPLACE content.
 *    - Non-empty SEARCH, Empty REPLACE: Deletes the matched content (deletion operation).
 *    - Malformed Blocks: If a new SEARCH block is encountered while still processing another
 *      block, the previous block is abandoned and processing starts on the new block.
 *
 * 4. Applying Changes:
 *    - Before encountering the "=======" marker, lines are accumulated as search content.
 *    - After "=======" and before ">>>>>>> REPLACE", lines are accumulated as replacement content.
 *    - Once the block is complete (">>>>>>> REPLACE"), the matched section in the original
 *      file is replaced with the accumulated replacement lines, and the position in the original
 *      file is advanced.
 *
 * 5. Incremental Output:
 *    - As soon as the match location is found and we are in the REPLACE section, each new
 *      replacement line is appended to the result so that partial updates can be viewed
 *      incrementally.
 *
 * 6. Partial Markers:
 *    - If the final line of the chunk looks like it might be part of a marker but is not one
 *      of the known markers, it is removed. This prevents incomplete or partial markers
 *      from corrupting the output.
 *
 * 7. Finalization:
 *    - Once all chunks have been processed (when `isFinal` is true), any remaining original
 *      content after the last replaced section is appended to the result.
 *    - Trailing newlines are not forcibly added. The code tries to output exactly what is specified.
 *
 * 8. Optimization:
 *    - The function tracks which regions of the file were changed and returns this information
 *      along with the new content.
 *    - Early exit logic is implemented to avoid processing the entire file when all SEARCH/REPLACE
 *      blocks have been found and processed.
 *
 * Errors:
 * - If the search block cannot be matched using any of the available matching strategies,
 *   an error is thrown.
 */
export async function constructNewFileContent(
	diffContent: string,
	originalContent: string,
	isFinal: boolean,
): Promise<FileChangeResult> {
	// Use StringBuilder for efficient incremental string construction
	const result = new StringBuilder()
	let lastProcessedIndex = 0
	const changedRegions: ChangeRegion[] = []

	// Track current position in the result for determining replacement regions
	let resultLength = 0

	// Use arrays for search and replace content to avoid string concatenation
	const searchSegments: string[] = []
	const replaceSegments: string[] = []
	let inSearch = false
	let inReplace = false

	let searchMatchIndex = -1
	let searchEndIndex = -1
	let replacementStartOffset = -1

	// Create line index for large files to optimize search operations
	const isLargeFile = LineIndex.shouldUseIndex(originalContent)
	const lineIndex = isLargeFile ? new LineIndex(originalContent) : undefined

	let lines = diffContent.split("\n")

	// If the last line looks like a partial marker but isn't recognized,
	// remove it because it might be incomplete.
	const lastLine = lines[lines.length - 1]
	if (
		lines.length > 0 &&
		(lastLine.startsWith("<") || lastLine.startsWith("=") || lastLine.startsWith(">")) &&
		lastLine !== "<<<<<<< SEARCH" &&
		lastLine !== "=======" &&
		lastLine !== ">>>>>>> REPLACE"
	) {
		lines.pop()
	}

	// Early exit check - if this is the final chunk and there are no SEARCH blocks,
	// we can skip processing and just return the current result
	if (isFinal && !diffContent.includes("<<<<<<< SEARCH")) {
		// No more SEARCH blocks to process
		if (lastProcessedIndex < originalContent.length) {
			result.appendSlice(originalContent, lastProcessedIndex, originalContent.length)
		}
		return {
			content: result.toString(),
			changedRegions,
		}
	}

	for (const line of lines) {
		if (line === "<<<<<<< SEARCH") {
			// If we were previously in another section, finalize it
			if (inSearch || inReplace) {
				// This is a malformed block - missing end marker
				// Reset state to start a new block
				inSearch = false
				inReplace = false
				searchSegments.length = 0
				replaceSegments.length = 0
			}

			inSearch = true
			continue
		}

		if (line === "=======") {
			inSearch = false
			inReplace = true

			// Create complete search content without string concatenation
			let currentSearchContent = searchSegments.join("\n")
			// Only add trailing newline if there are segments (avoiding concatenation)
			if (searchSegments.length > 0) {
				currentSearchContent = currentSearchContent + "\n"
			}

			// Explicit handling for edge cases
			if (!currentSearchContent) {
				// Empty search block
				if (originalContent.length === 0) {
					// New file scenario: nothing to match, just start inserting
					searchMatchIndex = 0
					searchEndIndex = 0
				} else {
					// Complete file replacement scenario: treat the entire file as matched
					searchMatchIndex = 0
					searchEndIndex = originalContent.length
				}
			} else {
				// Add check for inefficient full-file search
				// if (currentSearchContent.trim() === originalContent.trim()) {
				// 	throw new Error(
				// 		"The SEARCH block contains the entire file content. Please either:\n" +
				// 			"1. Use an empty SEARCH block to replace the entire file, or\n" +
				// 			"2. Make focused changes to specific parts of the file that need modification.",
				// 	)
				// }

				// Exact search match scenario using Boyer-Moore algorithm
				const exactIndex = boyerMooreSearch(originalContent, currentSearchContent, lastProcessedIndex)
				if (exactIndex !== -1) {
					searchMatchIndex = exactIndex
					searchEndIndex = exactIndex + currentSearchContent.length
				} else {
					// Attempt fallback line-trimmed matching
					const lineMatch = lineTrimmedFallbackMatch(
						originalContent,
						currentSearchContent,
						lastProcessedIndex,
						lineIndex,
					)
					if (lineMatch) {
						;[searchMatchIndex, searchEndIndex] = lineMatch
					} else {
						// Try block anchor fallback for larger blocks
						const blockMatch = blockAnchorFallbackMatch(
							originalContent,
							currentSearchContent,
							lastProcessedIndex,
							lineIndex,
						)
						if (blockMatch) {
							;[searchMatchIndex, searchEndIndex] = blockMatch
						} else {
							throw new Error(
								`The SEARCH block:\n${currentSearchContent.trimEnd()}\n...does not match anything in the file.`,
							)
						}
					}
				}
			}

			// Output everything up to the match location
			if (searchMatchIndex > lastProcessedIndex) {
				result.appendSlice(originalContent, lastProcessedIndex, searchMatchIndex)
				resultLength += searchMatchIndex - lastProcessedIndex
			}

			// Remember where this replacement starts in the result
			replacementStartOffset = resultLength
			continue
		}

		if (line === ">>>>>>> REPLACE") {
			// Finished one replace block

			// If this was a deletion (empty replace) we don't need to do anything special
			// as we've already advanced past the matched content without adding replacement content

			// Track where this replacement ends
			const replacementEndOffset = resultLength

			// Add this change region to our tracking array
			if (searchMatchIndex !== -1 && replacementStartOffset !== -1) {
				const startLine = getLineNumberFromOffset(result.toString(), replacementStartOffset)
				const endLine = getLineNumberFromOffset(result.toString(), replacementEndOffset)

				changedRegions.push({
					startOffset: replacementStartOffset,
					endOffset: replacementEndOffset,
					startLine,
					endLine,
				})
			}

			// Advance lastProcessedIndex to after the matched section
			lastProcessedIndex = searchEndIndex

			// Reset for next block
			inSearch = false
			inReplace = false
			searchSegments.length = 0
			replaceSegments.length = 0
			searchMatchIndex = -1
			searchEndIndex = -1
			replacementStartOffset = -1

			// EARLY EXIT: Check if there are more SEARCH blocks in the remaining content
			if (isFinal) {
				// Look for more SEARCH blocks in the remaining diffContent
				const remainingText = diffContent.slice(diffContent.indexOf(line) + line.length)
				if (!remainingText.includes("<<<<<<< SEARCH")) {
					// No more SEARCH blocks, we can finish early
					if (lastProcessedIndex < originalContent.length) {
						result.appendSlice(originalContent, lastProcessedIndex, originalContent.length)
					}
					return {
						content: result.toString(),
						changedRegions,
					}
				}
			}

			continue
		}

		// Accumulate content for search or replace
		// NOTE: search/replace blocks must be arranged in the order they appear in the file due to how we build the content using lastProcessedIndex
		if (inSearch) {
			searchSegments.push(line)
		} else if (inReplace) {
			replaceSegments.push(line)
			// Output replacement lines immediately if we know the insertion point
			if (searchMatchIndex !== -1) {
				// Use appendLine for more efficient line addition
				result.appendLine(line)
				resultLength += line.length + 1 // +1 for newline
			}
		}
	}

	// If this is the final chunk, append any remaining original content
	if (isFinal && lastProcessedIndex < originalContent.length) {
		result.appendSlice(originalContent, lastProcessedIndex, originalContent.length)
	}

	// Return both the new content and the change regions
	return {
		content: result.toString(),
		changedRegions,
	}
}
