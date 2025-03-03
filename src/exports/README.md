# Archimedes API

The Archimedes extension exposes an API that can be used by other extensions. This API may be backwards compatible to Archimedes, the upstream project Archimedes was forked from. To use this API in your extension:

1. Copy `src/extension-api/archimedes.d.ts` to your extension's source directory.
2. Include `archimedes.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    const archimedesExtension = vscode.extensions.getExtension<ArchimedesAPI>("org.cosmix.archimedes")

    if (!archimedesExtension?.isActive) {
    	throw new Error("Archimedes extension is not activated")
    }

    const cline = archimedesExtension.exports

    if (cline) {
    	// Now you can use the API

    	// Set custom instructions
    	await cline.setCustomInstructions("Talk like a pirate")

    	// Get custom instructions
    	const instructions = await cline.getCustomInstructions()
    	console.log("Current custom instructions:", instructions)

    	// Start a new task with an initial message
    	await cline.startNewTask("Hello, Archimedes! Let's make a new project...")

    	// Start a new task with an initial message and images
    	await cline.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
    	await cline.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
    	await cline.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
    	await cline.pressSecondaryButton()
    } else {
    	console.error("Archimedes API is not available")
    }
    ```

    **Note:** To ensure that the `org.cosmix.archimedes` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "org.cosmix.archimedes"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `archimedes.d.ts` file.
