# Unimarkup VS Code Extension

Official Visual Studio Code extensions for Unimarkup.

**WIP**

# Dev
## Setup

The VS Code extension looks for the server binary in a platform-specific subfolder under `server_bin`.
For Windows, the subfolder is `windows`, for Linux `linux`, and for macOS `macos`. 
Build tasks for Windows and Linux are available to build and copy the server binary into `server_bin` automatically.
The `unimarkup-lsp` repository must be located relative to this repository to be reachable for the build task at `${workspaceFolder}/../unimarkup-lsp/`.

## Launch the client

The launch script `Launch Client` may be used to launch a VS Code instance for testing the extension.
The extension is automatically started by creating/opening a `.um` file.

# License

MIT Licensed
