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
export function getLineNumberFromOffset(content: string, offset: number): number {
	const textUpToOffset = content.slice(0, offset)
	return (textUpToOffset.match(/\n/g) || []).length
}
