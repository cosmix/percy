### .clineignore Support

To give you more control over which files are accessible to Percy, we've implemented `.clineignore` functionality, similar to `.gitignore`. This allows you to specify files and directories that Percy should **not** access or process. This is useful for:

*   **Privacy:** Preventing Percy from accessing sensitive or private files in your workspace.
*   **Performance:**  Excluding large directories or files that are irrelevant to your tasks, potentially improving the efficiency of Percy.
*   **Context Management:**  Focusing Percy's attention on the relevant parts of your project.

**How to use `.clineignore`**

1.  **Create a `.clineignore` file:** In the root directory of your workspace (the same level as your `.vscode` folder, or the top level folder you opened in VS Code), create a new file named `.clineignore`.

2.  **Define ignore patterns:** Open the `.clineignore` file and specify the patterns for files and directories you want Percy to ignore. The syntax is the same as `.gitignore`:

    *   Each line in the file represents a pattern.
    *   **Standard glob patterns are supported:**
        *   `*` matches zero or more characters
        *   `?` matches one character
        *   `[]` matches a character range
        *   `**` matches any number of directories and subdirectories.

    *   **Directory patterns:** Append `/` to the end of a pattern to specify a directory.
    *   **Negation patterns:** Start a pattern with `!` to negate (un-ignore) a previously ignored pattern.
    *   **Comments:** Start a line with `#` to add comments.

    **Example `.clineignore` file:**

    ```
    # Ignore log files
    *.log

    # Ignore the entire 'node_modules' directory
    node_modules/

    # Ignore all files in the 'temp' directory and its subdirectories
    temp/**

    # But DO NOT ignore 'important.log' even if it's in the root
    !important.log

    # Ignore any file named 'secret.txt' in any subdirectory
    **/secret.txt
    ```

3.  **Percy respects your `.clineignore`:** Once you save the `.clineignore` file, Percy will automatically recognize and apply these rules.

    *   **File Access Control:** Percy will not be able to read the content of ignored files using tools like `read_file`. If you attempt to use a tool on an ignored file, Percy will inform you that access is blocked due to `.clineignore` settings.
    *   **File Listing:** When you ask Percy to list files in a directory (e.g., using `list_files`), ignored files and directories will still be listed, but they will be marked with a **🔒** symbol next to their name to indicate that they are ignored. This helps you understand which files Percy can and cannot interact with.

4.  **Dynamic Updates:** Percy monitors your `.clineignore` file for changes. If you modify, create, or delete your `.clineignore` file, Percy will automatically update its ignore rules without needing to restart VS Code or the extension.

**In Summary**

The `.clineignore` file provides a powerful and flexible way to control Percy's access to your workspace files, enhancing privacy, performance, and context management. By leveraging familiar `.gitignore` syntax, you can easily tailor Percy's focus to the most relevant parts of your projects.