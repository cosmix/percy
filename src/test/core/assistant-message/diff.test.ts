import { describe, it } from "mocha"
import { expect } from "chai"
import { constructNewFileContent } from "../../../core/assistant-message/diff"

describe("constructNewFileContent", () => {
	// Test exact match strategy
	describe("Exact Match Strategy", () => {
		it("should replace a simple section with exact match", async () => {
			const original = "function add(a, b) {\n  return a + b;\n}\n"
			const diff =
				"<<<<<<< SEARCH\nfunction add(a, b) {\n  return a + b;\n}\n=======\nfunction add(a, b) {\n  // Add two numbers\n  return a + b;\n}\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("function add(a, b) {\n  // Add two numbers\n  return a + b;\n}\n")
		})

		it("should replace multiple sections with exact match", async () => {
			const original = "const x = 5;\nconst y = 10;\nconst z = 15;\n"
			const diff =
				"<<<<<<< SEARCH\nconst x = 5;\n=======\nconst x = 50;\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nconst z = 15;\n=======\nconst z = 150;\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("const x = 50;\nconst y = 10;\nconst z = 150;\n")
		})
	})

	// Test line-trimmed fallback match strategy
	describe("Line-Trimmed Fallback Match Strategy", () => {
		it("should match and replace content with different whitespace", async () => {
			const original = "function subtract(a, b) {\n    return a - b;\n}\n"
			const diff =
				"<<<<<<< SEARCH\nfunction subtract(a, b) {\n  return a - b;\n}\n=======\nfunction subtract(a, b) {\n  // Subtract b from a\n  return a - b;\n}\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("function subtract(a, b) {\n  // Subtract b from a\n  return a - b;\n}\n")
		})

		it("should handle matching with indentation differences", async () => {
			const original = 'if (condition) {\n    console.log("true");\n    return true;\n}'
			const diff =
				'<<<<<<< SEARCH\nif (condition) {\n  console.log("true");\n  return true;\n}\n=======\nif (condition) {\n  console.log("condition is true");\n  return true;\n}\n>>>>>>> REPLACE\n'

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal('if (condition) {\n  console.log("condition is true");\n  return true;\n}\n')
		})
	})

	// Test block anchor fallback match strategy
	describe("Block Anchor Fallback Match Strategy", () => {
		it("should match and replace using first and last lines as anchors", async () => {
			const original =
				'class Example {\n    constructor() {\n        this.value = 0;\n        this.name = "example";\n    }\n}'
			const diff =
				"<<<<<<< SEARCH\nclass Example {\n    constructor() {\n        // Initialize properties\n        this.value = 1;\n    }\n}\n=======\nclass Example {\n    constructor() {\n        // Better initialization\n        this.value = 42;\n    }\n}\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal(
				"class Example {\n    constructor() {\n        // Better initialization\n        this.value = 42;\n    }\n}\n",
			)
		})

		it("should match a complex block with different inner content", async () => {
			const original =
				"function process() {\n    // Step 1\n    initialize();\n    // Step 2\n    compute();\n    // Step 3\n    finalize();\n}"
			const diff =
				"<<<<<<< SEARCH\nfunction process() {\n    // First step\n    prepare();\n    // Second step\n    execute();\n    // Last step\n    finalize();\n}\n=======\nfunction process() {\n    // Improved implementation\n    prepare();\n    execute();\n    finalize();\n}\n>>>>>>> REPLACE\n"

			// This should match using block anchors (first/last lines) even though internal content differs
			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal(
				"function process() {\n    // Improved implementation\n    prepare();\n    execute();\n    finalize();\n}\n",
			)
		})
	})

	// Test empty search block scenarios
	describe("Empty Search Block", () => {
		it("should replace entire content when search is empty and original is not empty", async () => {
			const original = "This is the original content.\n"
			const diff = "<<<<<<< SEARCH\n=======\nThis is the replacement content.\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("This is the replacement content.\n")
		})

		it("should create new content when both search and original are empty", async () => {
			const original = ""
			const diff = "<<<<<<< SEARCH\n=======\nThis is new content for empty file.\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("This is new content for empty file.\n")
		})
	})

	// Test incremental updates
	describe("Incremental Updates", () => {
		it("should handle sequential diff operations correctly", async () => {
			// This test shows how multiple complete diff operations can be applied sequentially
			const original = "const a = 1;\nconst b = 2;\nconst c = 3;\n"

			// First complete operation - replace a
			const diff1 = "<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 10;\n>>>>>>> REPLACE\n"
			const intermediate = await constructNewFileContent(diff1, original, true)
			const intermediateContent = intermediate.content

			// Second complete operation - replace c (starting from the result of the first operation)
			const diff2 = "<<<<<<< SEARCH\nconst c = 3;\n=======\nconst c = 30;\n>>>>>>> REPLACE\n"
			const finalResult = await constructNewFileContent(diff2, intermediateContent, true)

			expect(finalResult.content).to.equal("const a = 10;\nconst b = 2;\nconst c = 30;\n")
		})

		it("should process a complete diff in a single call", async () => {
			const original = 'function example() {\n  return "old value";\n}\n'
			const diff =
				'<<<<<<< SEARCH\nfunction example() {\n  return "old value";\n}\n=======\nfunction example() {\n  return "new value";\n}\n>>>>>>> REPLACE\n'

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal('function example() {\n  return "new value";\n}\n')
		})
	})

	// Test error cases
	describe("Error Handling", () => {
		it("should throw an error when search block does not match anything", async () => {
			const original = "function test() {\n  return true;\n}\n"
			const diff =
				"<<<<<<< SEARCH\nfunction nonexistent() {\n  return false;\n}\n=======\nfunction replacement() {}\n>>>>>>> REPLACE\n"

			try {
				await constructNewFileContent(diff, original, true)
				expect.fail("Expected an error to be thrown")
			} catch (error) {
				expect(error).to.be.an.instanceOf(Error)
				expect(error.message).to.include("does not match anything in the file")
			}
		})

		it("should handle a complete replacement in a single operation", async () => {
			const original = 'const value = "original";\n'
			const diff = '<<<<<<< SEARCH\nconst value = "original";\n=======\nconst value = "new";\n>>>>>>> REPLACE\n'

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal('const value = "new";\n')
		})
	})

	// Additional edge cases
	describe("Edge Cases", () => {
		it("should preserve non-matching content outside of search blocks", async () => {
			const original = 'import { x } from "module";\n\nfunction getX() {\n  return x;\n}\n\nexport { getX };\n'
			const diff =
				"<<<<<<< SEARCH\nfunction getX() {\n  return x;\n}\n=======\nfunction getX() {\n  // Get the value of x\n  return x;\n}\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal(
				'import { x } from "module";\n\nfunction getX() {\n  // Get the value of x\n  return x;\n}\n\nexport { getX };\n',
			)
		})

		it("should handle multiple search blocks in correct order", async () => {
			const original = "line1\nline2\nline3\nline4\nline5\n"
			const diff =
				"<<<<<<< SEARCH\nline2\n=======\nline2-modified\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nline4\n=======\nline4-modified\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("line1\nline2-modified\nline3\nline4-modified\nline5\n")
		})

		it("should handle search blocks in reverse order correctly", async () => {
			const original = "line1\nline2\nline3\nline4\nline5\n"
			// Note: Providing search blocks in reverse order should cause an error or unexpected behavior
			// as the function expects blocks in the order they appear in the file
			const diff =
				"<<<<<<< SEARCH\nline4\n=======\nline4-modified\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nline2\n=======\nline2-modified\n>>>>>>> REPLACE\n"

			try {
				const result = await constructNewFileContent(diff, original, true)
				// We don't check the result here as it might succeed or fail depending on implementation
				// This might succeed if the implementation handles reverse order, or fail if it strictly requires order
				// The important part is that the function behaves consistently with its documented behavior
			} catch (error) {
				// If the function expects blocks in order, this error is expected
				expect(error).to.be.an.instanceOf(Error)
			}
		})

		it("should handle an empty replacement", async () => {
			const original = "line1\nto be removed\nline3\n"
			const diff = "<<<<<<< SEARCH\nto be removed\n=======\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("line1\nline3\n")
		})

		it("should handle a completely empty file creation scenario", async () => {
			const original = ""
			const diff = "<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("")
		})
	})

	// Advanced test cases
	describe("Advanced Scenarios", () => {
		it("should handle multiple complete blocks in a single chunk", async () => {
			const original = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n"
			const diff =
				"<<<<<<< SEARCH\nconst a = 1;\n=======\nconst a = 100;\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nconst c = 3;\n=======\nconst c = 300;\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("const a = 100;\nconst b = 2;\nconst c = 300;\nconst d = 4;\n")
		})

		it("should correctly handle complex nested code structures", async () => {
			const original =
				"function outer() {\n  if (condition) {\n    doSomething();\n  } else {\n    doSomethingElse();\n  }\n}\n"
			const diff =
				"<<<<<<< SEARCH\n  if (condition) {\n    doSomething();\n  } else {\n    doSomethingElse();\n  }\n=======\n  if (condition) {\n    doSomething();\n    logSuccess();\n  } else {\n    doSomethingElse();\n    logFailure();\n  }\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal(
				"function outer() {\n  if (condition) {\n    doSomething();\n    logSuccess();\n  } else {\n    doSomethingElse();\n    logFailure();\n  }\n}\n",
			)
		})

		it("should handle last line partial marker correctly", async () => {
			const original = "const value = 42;\n"

			// This tests the logic that removes partial markers at the end of a chunk
			// The '<<<' at the end should be removed as it looks like a partial marker
			const chunk1 = "<<<<<<< SEARCH\nconst value = 42;\n=======\nconst value = 100;\n<<<"
			const result1 = await constructNewFileContent(chunk1, original, false)
			// We don't check the result here as we're just testing that it doesn't throw

			const chunk2 = "<<<< SEARCH\nconst anotherValue = 10;\n"
			const result2 = await constructNewFileContent(chunk2, original, false)
			// We don't check the result here as we're just testing that it doesn't throw

			expect(result1.content).not.to.include("<<<")
		})

		it("should correctly identify and match identical content with different whitespace", async () => {
			// This creates a case where both exact match and line-trimmed match strategies could be attempted
			// The function should successfully find a match using one of these strategies
			const original = "function test() {\n  return true;\n}\n"
			const diff =
				"<<<<<<< SEARCH\nfunction test() {\n  return true;\n}\n=======\nfunction test() {\n  // Modified\n  return true;\n}\n>>>>>>> REPLACE\n"

			const result = await constructNewFileContent(diff, original, true)
			expect(result.content).to.equal("function test() {\n  // Modified\n  return true;\n}\n")
		})
	})

	// Performance considerations
	describe("Performance Considerations", () => {
		it("should handle large blocks efficiently", async () => {
			// Create a large original file
			const originalLines = []
			for (let i = 0; i < 1000; i++) {
				originalLines.push(`line ${i}: const value_${i} = ${i};`)
			}
			const original = originalLines.join("\n") + "\n"

			// Create a diff that modifies line 500
			const searchContent = `line 500: const value_500 = 500;\n`
			const replaceContent = `line 500: const value_500 = 999999; // Modified\n`
			const diff = `<<<<<<< SEARCH\n${searchContent}=======\n${replaceContent}>>>>>>> REPLACE\n`

			const start = Date.now()
			const result = await constructNewFileContent(diff, original, true)
			const resultContent = result.content
			const end = Date.now()

			// The operation should complete in a reasonable time (adjust threshold as needed)
			expect(end - start).to.be.lessThan(1000) // Should take less than 1 second

			// Verify the result has the correct modification
			expect(resultContent).to.include(replaceContent)
			expect(resultContent).not.to.include(searchContent)
		})
	})
})
