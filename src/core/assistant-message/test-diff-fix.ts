import { constructNewFileContent } from "./diff"

// Test function to manually verify our fix
async function testDiffFix() {
	console.log("Testing diff fix for new files...")

	// Test case 1: New file (empty original content)
	const diffContentNewFile = `<<<<<<< SEARCH
=======
const newFileContent = "This is content for a new file";
console.log(newFileContent);
>>>>>>> REPLACE`

	const originalContentNewFile = "" // Empty for new files

	// Test with deferMatching=true and isFinal=false (streaming mode)
	console.log("\nTest Case 1: New file during streaming")
	const resultNewFile = await constructNewFileContent(
		diffContentNewFile,
		originalContentNewFile,
		false, // isFinal
		true, // deferMatching
	)

	console.log("Result:")
	console.log(resultNewFile)
	console.log('Expected to contain "const newFileContent" and "console.log(newFileContent)"')

	// Test case 2: Existing file
	const diffContentExistingFile = `<<<<<<< SEARCH
const existingContent = "This is existing content";
=======
const updatedContent = "This is updated content";
>>>>>>> REPLACE`

	const originalContentExistingFile = 'const existingContent = "This is existing content";\n'

	console.log("\nTest Case 2: Existing file during streaming")
	const resultExistingFile = await constructNewFileContent(
		diffContentExistingFile,
		originalContentExistingFile,
		false, // isFinal
		true, // deferMatching
	)

	console.log("Result:")
	console.log(resultExistingFile)
	console.log("Expected to be the original content")
}

// Run the test
testDiffFix().catch(console.error)
