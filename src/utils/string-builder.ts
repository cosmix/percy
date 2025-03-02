/**
 * A utility class for efficient incremental string construction.
 * Optimized for building large strings by reducing memory allocations.
 */
export class StringBuilder {
	private chunks: string[] = []
	private length: number = 0

	/**
	 * Appends a string to the builder
	 */
	append(str: string): StringBuilder {
		if (str.length > 0) {
			this.chunks.push(str)
			this.length += str.length
		}
		return this
	}

	/**
	 * Appends a slice from source string without creating intermediate strings
	 */
	appendSlice(source: string, start: number, end: number): StringBuilder {
		if (start < end) {
			const chunk = source.slice(start, end)
			this.chunks.push(chunk)
			this.length += end - start
		}
		return this
	}

	/**
	 * Appends a string followed by a newline
	 */
	appendLine(str: string): StringBuilder {
		this.append(str)
		this.append("\n")
		return this
	}

	/**
	 * Converts the accumulated chunks into a single string
	 */
	toString(): string {
		return this.chunks.join("")
	}

	/**
	 * Clears all content from the builder
	 */
	clear(): void {
		this.chunks = []
		this.length = 0
	}

	/**
	 * Returns the total length of the content
	 */
	getLength(): number {
		return this.length
	}
}
