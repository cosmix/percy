/**
 * Attempts a line-trimmed fallback match for the given search content in the original content.
 * It tries to match `searchContent` lines against a block of lines in `originalContent` starting
 * from `lastProcessedIndex`. Lines are matched by trimming leading/trailing whitespace and ensuring
 * they are identical afterwards.
 *
 * Returns [matchIndexStart, matchIndexEnd] if found, or false if not found.
 */
function lineTrimmedFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number,
	lineStartOffsets: number[],
	getLineForOffset: (offset: number) => number,
): [number, number] | false {
	// Split both contents into lines
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")

	// Trim trailing empty line if exists (from the trailing \n in searchContent)
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}

	// Find the line number where startIndex falls
	const startLineNum = getLineForOffset(startIndex)

	// Ensure the array has enough elements
	if (startLineNum >= originalLines.length || startLineNum < 0) {
		return false
	}

	// For each possible starting position in original content
	for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
		// Verify index is valid before accessing
		if (i < 0 || i >= lineStartOffsets.length) {
			continue
		}
		let matches = true

		// Try to match all search lines from this position
		for (let j = 0; j < searchLines.length; j++) {
			const originalTrimmed = originalLines[i + j].trim()
			const searchTrimmed = searchLines[j].trim()

			if (originalTrimmed !== searchTrimmed) {
				matches = false
				break
			}
		}

		// If we found a match, calculate the exact character positions
		if (matches) {
			const matchStartIndex = lineStartOffsets[i]
			const matchEndIndex =
				i + searchLines.length <= originalLines.length
					? i + searchLines.length < originalLines.length
						? lineStartOffsets[i + searchLines.length]
						: originalContent.length
					: originalContent.length

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
 * @param originalContent - The full content of the original file
 * @param searchContent - The content we're trying to find in the original file
 * @param startIndex - The character index in originalContent where to start searching
 * @returns A tuple of [startIndex, endIndex] if a match is found, false otherwise
 */

/**
 * Calculates and returns line offset information for efficient position calculations.
 * @param lines The array of lines to process
 * @returns An object containing:
 *   - lineStartOffsets: Array where each index i contains the character offset of line i
 *   - lineEndOffsets: Array where each index i contains the character offset of the end of line i
 *   - getLineForOffset: Function to get line number for a character offset
 */

/**
 * Calculates and returns line offset information for efficient position calculations.
 * @param lines The array of lines to process
 * @param originalContent Optional original content to detect line endings
 * @returns An object containing:
 *   - lineStartOffsets: Array where each index i contains the character offset of line i
 *   - lineEndOffsets: Array where each index i contains the character offset of the end of line i
 *   - getLineForOffset: Function to get line number for a character offset
 */
function calculateLineOffsets(
	lines: string[],
	originalContent?: string,
): {
	lineStartOffsets: number[]
	lineEndOffsets: number[]
	getLineForOffset: (offset: number) => number
} {
	const lineStartOffsets: number[] = []
	const lineEndOffsets: number[] = []

	// Detect if we're dealing with CRLF or LF
	const detectLineEnding = (content: string): string => {
		return content.includes("\r\n") ? "\r\n" : "\n"
	}

	const lineEnding = originalContent ? detectLineEnding(originalContent) : "\n"
	const lineEndingLength = lineEnding.length

	let currentOffset = 0
	for (let i = 0; i < lines.length; i++) {
		lineStartOffsets.push(currentOffset)
		currentOffset += lines[i].length
		lineEndOffsets.push(currentOffset)
		// Only add line ending for non-last lines or if original content ends with newline
		if (i < lines.length - 1 || (originalContent && originalContent.endsWith(lineEnding))) {
			currentOffset += lineEndingLength
		}
	}

	// Binary search function to find line number for a character offset
	const getLineForOffset = (offset: number): number => {
		let low = 0
		let high = lineStartOffsets.length - 1

		while (low <= high) {
			const mid = Math.floor((low + high) / 2)

			if (offset < lineStartOffsets[mid]) {
				high = mid - 1
			} else if (offset > lineEndOffsets[mid]) {
				low = mid + 1
			} else {
				return mid // Found the line containing this offset
			}
		}

		return low // If not found exactly, return the closest line
	}

	return { lineStartOffsets, lineEndOffsets, getLineForOffset }
}

/**
 * Creates a lightweight preview of the diff result without performing expensive matching operations.
 * This is used during streaming to provide a visual approximation of the changes.
 *
 * @param diffContent The diff content with SEARCH/REPLACE blocks
 * @param originalContent The original file content
 * @returns A preview of what the file might look like after applying the diff
 */
function createLightweightPreview(diffContent: string, originalContent: string): string {
	// Parse the diff content to extract complete SEARCH/REPLACE blocks
	const blocks = parseSimpleDiffBlocks(diffContent)
	let previewContent = originalContent

	// Apply each complete block to the preview content
	for (const block of blocks) {
		if (block.complete) {
			// Handle empty search block (special cases)
			if (!block.search.trim()) {
				if (originalContent.trim() === "") {
					// New file - just use replacement
					previewContent = block.replace
				} else {
					// Full file replacement
					previewContent = block.replace
				}
				continue
			}

			// Try a simple exact match first for efficiency
			const searchPos = previewContent.indexOf(block.search)
			if (searchPos !== -1) {
				// Found an exact match, apply the replacement
				previewContent =
					previewContent.substring(0, searchPos) +
					block.replace +
					previewContent.substring(searchPos + block.search.length)
				continue
			}

			// If exact match fails, try a simple line-based match
			// This is a simplified version that doesn't use the more expensive matching algorithms
			const previewLines = previewContent.split("\n")
			const searchLines = block.search.split("\n")

			// Skip empty search lines
			if (searchLines.length === 0 || (searchLines.length === 1 && searchLines[0] === "")) {
				continue
			}

			// Try to find the first line of the search block
			for (let i = 0; i < previewLines.length; i++) {
				if (previewLines[i].trim() === searchLines[0].trim()) {
					// Check if subsequent lines match
					let matches = true
					for (let j = 1; j < searchLines.length && i + j < previewLines.length; j++) {
						if (previewLines[i + j].trim() !== searchLines[j].trim()) {
							matches = false
							break
						}
					}

					if (matches) {
						// Found a match, replace the lines
						const replaceLines = block.replace.split("\n")
						previewLines.splice(i, searchLines.length, ...replaceLines)
						previewContent = previewLines.join("\n")
						break
					}
				}
			}
		}
	}

	// Preserve line endings from original content
	if (originalContent.endsWith("\n") && !previewContent.endsWith("\n")) {
		previewContent += "\n"
	}

	return previewContent
}

/**
 * Parses the diff content to extract complete SEARCH/REPLACE blocks.
 *
 * @param diffContent The diff content with SEARCH/REPLACE blocks
 * @returns An array of parsed blocks with search and replace content
 */

function parseSimpleDiffBlocks(diffContent: string): Array<{
	search: string
	replace: string
	complete: boolean
	startLine: number
	endLine: number
	isValid: boolean // New property to track validity
}> {
	const lines = diffContent.split("\n")
	const blocks: Array<{
		search: string
		replace: string
		complete: boolean
		startLine: number
		endLine: number
		isValid: boolean
	}> = []

	let currentBlock: {
		search: string[]
		replace: string[]
		inSearch: boolean
		inReplace: boolean
		complete: boolean
		startLine: number
		endLine: number
		isValid: boolean
	} = {
		search: [],
		replace: [],
		inSearch: false,
		inReplace: false,
		complete: false,
		startLine: -1,
		endLine: -1,
		isValid: true,
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line === "<<<<<<< SEARCH") {
			// Check if we're already in a block (invalid nesting)
			if (currentBlock.inSearch || currentBlock.inReplace) {
				// Mark current block as invalid and close it
				currentBlock.isValid = false
				currentBlock.complete = true
				currentBlock.endLine = i - 1
				blocks.push({
					search: currentBlock.search.join("\n"),
					replace: currentBlock.replace.join("\n"),
					complete: currentBlock.complete,
					startLine: currentBlock.startLine,
					endLine: currentBlock.endLine,
					isValid: currentBlock.isValid,
				})
			}

			// Start a new block
			currentBlock = {
				search: [],
				replace: [],
				inSearch: true,
				inReplace: false,
				complete: false,
				startLine: i,
				endLine: -1,
				isValid: true,
			}
		} else if (line === "=======") {
			// Check if we're in search mode, otherwise invalid sequence
			if (!currentBlock.inSearch || currentBlock.inReplace) {
				currentBlock.isValid = false
			}
			// Switch from search to replace
			currentBlock.inSearch = false
			currentBlock.inReplace = true
		} else if (line === ">>>>>>> REPLACE") {
			// Check for valid state transition
			if (!currentBlock.inReplace) {
				currentBlock.isValid = false
			}

			// End the block
			currentBlock.inSearch = false
			currentBlock.inReplace = false
			currentBlock.complete = true
			currentBlock.endLine = i

			// Add the completed block to the list
			blocks.push({
				search: currentBlock.search.join("\n"),
				replace: currentBlock.replace.join("\n"),
				complete: true,
				startLine: currentBlock.startLine,
				endLine: currentBlock.endLine,
				isValid: currentBlock.isValid,
			})
		} else if (currentBlock.inSearch) {
			// Add line to search content
			currentBlock.search.push(line)
		} else if (currentBlock.inReplace) {
			// Add line to replace content
			currentBlock.replace.push(line)
		}
	}

	// If we have a partial block at the end, add it too
	if ((currentBlock.inSearch || currentBlock.inReplace) && !currentBlock.complete) {
		blocks.push({
			search: currentBlock.search.join("\n"),
			replace: currentBlock.replace.join("\n"),
			complete: false,
			startLine: currentBlock.startLine,
			endLine: lines.length - 1,
			isValid: false, // Partial blocks are invalid
		})
	}

	return blocks
}

function blockAnchorFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number,
	lineStartOffsets: number[],
	getLineForOffset: (offset: number) => number,
): [number, number] | false {
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
	const startLineNum = getLineForOffset(startIndex)

	// Ensure the array has enough elements
	if (startLineNum >= originalLines.length || startLineNum < 0) {
		return false
	}

	// Look for matching start and end anchors
	for (let i = startLineNum; i <= originalLines.length - searchBlockSize; i++) {
		// Verify index is valid before accessing
		if (i < 0 || i >= lineStartOffsets.length) {
			continue
		}
		// Check if first line matches
		if (originalLines[i].trim() !== firstLineSearch) {
			continue
		}

		// Check if last line matches at the expected position
		if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) {
			continue
		}

		const matchStartIndex = lineStartOffsets[i]
		const matchEndIndex =
			i + searchBlockSize < originalLines.length ? lineStartOffsets[i + searchBlockSize] : originalContent.length

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
 * 3. Empty SEARCH Section:
 *    - If SEARCH is empty and the original file is empty, this indicates creating a new file
 *      (pure insertion).
 *    - If SEARCH is empty and the original file is not empty, this indicates a complete
 *      file replacement (the entire original content is considered matched and replaced).
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
 * 8. Deferred Matching:
 *    - When `deferMatching` is true and it's not the final chunk, the function can return a
 *      simplified preview result without performing expensive matching operations.
 *    - This is useful for streaming mode where visual updates are needed but actual diffing
 *      can be deferred until the final chunk.
 *
 * Errors:
 * - If the search block cannot be matched using any of the available matching strategies,
 *   an error is thrown.
 */

export async function constructNewFileContent(
	diffContent: string,
	originalContent: string,
	isFinal: boolean,
	deferMatching: boolean = false,
): Promise<string> {
	// If deferMatching is true and not the final chunk,
	// return a lightweight preview result without expensive matching
	if (deferMatching && !isFinal) {
		return createLightweightPreview(diffContent, originalContent)
	}

	// Parse the diff blocks once for validation
	const blocks = parseSimpleDiffBlocks(diffContent)

	// Check for invalid blocks and log warnings
	for (const block of blocks) {
		if (block.complete && !block.isValid) {
			console.warn(`Skipping invalid diff block at lines ${block.startLine}-${block.endLine}`)
		}
	}

	// For final updates or when not deferring matching, perform the full diff processing
	// Calculate line offsets once for efficient position calculations
	const originalLines = originalContent.split("\n")
	const { lineStartOffsets, getLineForOffset } = calculateLineOffsets(originalLines, originalContent)

	const resultLines: string[] = []
	let lastProcessedIndex = 0

	const currentSearchLines: string[] = []
	const currentReplaceLines: string[] = []
	let inSearch = false
	let inReplace = false

	let searchMatchIndex = -1
	let searchEndIndex = -1

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

	// Process each line in the diff content
	for (const line of lines) {
		if (line === "<<<<<<< SEARCH") {
			inSearch = true
			currentSearchLines.length = 0 // Clear array
			currentReplaceLines.length = 0 // Clear array
			continue
		}

		if (line === "=======") {
			inSearch = false
			inReplace = true

			// Join search lines for further processing
			const currentSearchContent = currentSearchLines.join("\n") + "\n"

			if (!currentSearchContent.trim()) {
				// Empty search block handling
				if (originalContent.length === 0) {
					searchMatchIndex = 0
					searchEndIndex = 0
				} else {
					searchMatchIndex = 0
					searchEndIndex = originalContent.length
				}
			} else {
				// Try exact match first (most efficient)
				const exactIndex = originalContent.indexOf(currentSearchContent, lastProcessedIndex)
				if (exactIndex !== -1) {
					searchMatchIndex = exactIndex
					searchEndIndex = exactIndex + currentSearchContent.length
				} else {
					// Try fallback matching strategies
					const lineMatch = lineTrimmedFallbackMatch(
						originalContent,
						currentSearchContent,
						lastProcessedIndex,
						lineStartOffsets,
						getLineForOffset,
					)

					if (lineMatch) {
						;[searchMatchIndex, searchEndIndex] = lineMatch
					} else {
						const blockMatch = blockAnchorFallbackMatch(
							originalContent,
							currentSearchContent,
							lastProcessedIndex,
							lineStartOffsets,
							getLineForOffset,
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

			// Add content up to the match point to result
			const contentUpToMatch = originalContent.slice(lastProcessedIndex, searchMatchIndex)
			if (contentUpToMatch) {
				const contentLines = contentUpToMatch.split("\n")
				resultLines.push(...contentLines)

				// Handle case where content doesn't end with newline
				if (!contentUpToMatch.endsWith("\n") && resultLines.length > 0) {
					const lastResultLine = resultLines.pop() || ""
					resultLines.push(lastResultLine)
				}
			}

			continue
		}

		if (line === ">>>>>>> REPLACE") {
			// Finished one replace block
			lastProcessedIndex = searchEndIndex

			// Reset for next block
			inSearch = false
			inReplace = false
			currentSearchLines.length = 0
			currentReplaceLines.length = 0
			searchMatchIndex = -1
			searchEndIndex = -1
			continue
		}

		// Accumulate content for search or replace
		if (inSearch) {
			currentSearchLines.push(line)
		} else if (inReplace) {
			currentReplaceLines.push(line)
			// Output replacement lines immediately if we know the insertion point
			if (searchMatchIndex !== -1) {
				resultLines.push(line)
			}
		}
	}

	// If this is the final chunk, append any remaining original content
	if (isFinal && lastProcessedIndex < originalContent.length) {
		const remainingContent = originalContent.slice(lastProcessedIndex)
		const remainingLines = remainingContent.split("\n")

		// Add all but the last line
		if (remainingLines.length > 1) {
			resultLines.push(...remainingLines.slice(0, -1))
		}

		// Handle the last line specially to preserve trailing newlines
		const lastLine = remainingLines[remainingLines.length - 1]
		if (lastLine || remainingContent.endsWith("\n")) {
			resultLines.push(lastLine)
		}
	}

	// Join resultLines to create the final result
	let result = resultLines.join("\n")

	// Ensure the result ends with a newline if the original content did
	if (isFinal && originalContent.endsWith("\n") && !result.endsWith("\n")) {
		result += "\n"
	}

	return result
}
