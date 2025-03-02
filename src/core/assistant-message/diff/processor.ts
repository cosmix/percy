import { boyerMooreSearch } from "../../../utils/string"
import { StringBuilder } from "../../../utils/string-builder"
import { FileChangeResult, ChangeRegion, getLineNumberFromOffset } from "./types"
import { LineIndex } from "./line-index"
import { lineTrimmedFallbackMatch, blockAnchorFallbackMatch } from "./matching-strategies"

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
