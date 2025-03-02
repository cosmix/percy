import { LineIndex } from "./line-index"

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
export function lineTrimmedFallbackMatch(
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
export function blockAnchorFallbackMatch(
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
