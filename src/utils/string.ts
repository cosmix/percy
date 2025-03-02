/**
 * Fixes incorrectly escaped HTML entities in AI model outputs
 * @param text String potentially containing incorrectly escaped HTML entities from AI models
 * @returns String with HTML entities converted back to normal characters
 */
export function fixModelHtmlEscaping(text: string): string {
	return text
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&apos;/g, "'")
}

/**
 * Removes invalid characters (like the replacement character �) from a string
 * @param text String potentially containing invalid characters
 * @returns String with invalid characters removed
 */
export function removeInvalidChars(text: string): string {
	return text.replace(/\uFFFD/g, "")
}

/**
 * Boyer-Moore string search algorithm implementation.
 *
 * This function implements the Boyer-Moore string search algorithm which is more efficient
 * than naive methods, especially for larger patterns. It uses the bad character rule
 * to skip portions of the text that cannot match, significantly improving search performance.
 *
 * @param text - The source text to search within
 * @param pattern - The pattern to search for
 * @param startPos - Position in the text to start searching from
 * @returns The index of the match, or -1 if not found
 */
export function boyerMooreSearch(text: string, pattern: string, startPos: number = 0): number {
	if (pattern.length === 0) {
		return startPos
	}
	if (pattern.length > text.length - startPos) {
		return -1
	}

	// Preprocessing: Build the bad character table
	const badCharTable = new Map<string, number>()
	for (let i = 0; i < pattern.length - 1; i++) {
		badCharTable.set(pattern[i], pattern.length - 1 - i)
	}

	// Main search loop
	let offset = startPos
	while (offset <= text.length - pattern.length) {
		let j = pattern.length - 1

		// Match from right to left
		while (j >= 0 && pattern[j] === text[offset + j]) {
			j--
		}

		// Pattern found
		if (j < 0) {
			return offset
		}

		// Calculate shift using bad character rule
		const badCharShift = badCharTable.get(text[offset + j]) || pattern.length
		offset += Math.max(1, badCharShift)
	}

	return -1 // Pattern not found
}
