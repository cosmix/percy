/**
 * A class that maintains an index of lines in a file for efficient searching.
 * This is particularly useful for large files where we need to find specific
 * lines or patterns quickly without scanning the entire file.
 */
export class LineIndex {
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
