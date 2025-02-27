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

	// For each possible starting position in original content
	for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
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
				i + searchLines.length < originalLines.length ? lineStartOffsets[i + searchLines.length] : originalContent.length

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
function calculateLineOffsets(lines: string[]): {
	lineStartOffsets: number[]
	lineEndOffsets: number[]
	getLineForOffset: (offset: number) => number
} {
	const lineStartOffsets: number[] = []
	const lineEndOffsets: number[] = []

	let currentOffset = 0
	for (let i = 0; i < lines.length; i++) {
		lineStartOffsets.push(currentOffset)
		currentOffset += lines[i].length
		lineEndOffsets.push(currentOffset)
		currentOffset += 1 // +1 for \n
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
	// return a simpler result for preview purposes only
	if (deferMatching && !isFinal) {
		// For preview purposes, we just return the original content
		// This maintains the visual appearance without doing expensive diffing
		return originalContent
	}

	// Calculate line offsets once
	const originalLines = originalContent.split("\n")
	const { lineStartOffsets, getLineForOffset } = calculateLineOffsets(originalLines)

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
				// Empty search block handling (unchanged)
				if (originalContent.length === 0) {
					searchMatchIndex = 0
					searchEndIndex = 0
				} else {
					searchMatchIndex = 0
					searchEndIndex = originalContent.length
				}
			} else {
				// Exact search match scenario (unchanged)
				const exactIndex = originalContent.indexOf(currentSearchContent, lastProcessedIndex)
				if (exactIndex !== -1) {
					searchMatchIndex = exactIndex
					searchEndIndex = exactIndex + currentSearchContent.length
				} else {
					// Attempt fallback matches (unchanged except for converting currentSearchContent)
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

			// Convert the content up to the match point to string and add to result
			const contentUpToMatch = originalContent.slice(lastProcessedIndex, searchMatchIndex)

			// Instead of adding to result string, break it into lines and add to resultLines
			if (contentUpToMatch) {
				const contentLines = contentUpToMatch.split("\n")
				resultLines.push(...contentLines)

				// If the last content didn't end with a newline, adjust the array
				// to merge the last line with the next addition
				if (!contentUpToMatch.endsWith("\n") && resultLines.length > 0) {
					const lastResultLine = resultLines.pop() || ""
					resultLines.push(lastResultLine) // We'll concatenate to this later
				}
			}

			continue
		}

		if (line === ">>>>>>> REPLACE") {
			// Finished one replace block

			// Advance lastProcessedIndex to after the matched section
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

		// Accumulate content for search or replace using arrays
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

		// Handle the last line specially
		const lastLine = remainingLines[remainingLines.length - 1]
		if (lastLine || remainingContent.endsWith("\n")) {
			resultLines.push(lastLine)
		}
	}

	// Join resultLines to create the final result
	// Carefully handle the newlines to ensure we don't add/remove any
	let result = resultLines.join("\n")

	// Ensure the result ends with a newline if the original content did
	if (isFinal && originalContent.endsWith("\n") && !result.endsWith("\n")) {
		result += "\n"
	}

	return result
}
