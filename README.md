<img src="/assets/icons/icon.png" style="width: 200px"/>

# Percy

Percy is a fork of [Cline](https://www.github.com/cline/cline). It adds a number of minor features and improvements that have long been discussed in Cline's Discord or mentioned on the Cline repo, but never got prioritised. It also does away with all the "commercial features" the Cline project has been recently adding, e.g. accounts, telemetry, etc.

## Additional Features

- Auto-approve for file read and write operations only applies to file within the workspace
- Separate model selection/options for PLAN and ACT modes
- Full support for Claude Sonnet 3.7 'extended thinking' mode with configurable token budget for thinking and max (output) tokens
- Improved UI for Reasoning models
- 'Diffing' optimisations for `replace_in_file`
- Add collapsible recent history section in the 'main view' of the extension, so that you can hide recent tasks for privacy/confidentiality purposes (e.g. when sharing your screen with others)
