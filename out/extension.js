"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const path = require("path");
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
let client;
const renderedContents = new Map();
const PANEL_VIEW_TYPE = 'unimarkup.preview';
const previewPanels = new Set();
let activePreviewPanel;
function activate(context) {
    let serverPath = getServerPath();
    serverPath = context.asAbsolutePath(serverPath);
    let serverOptions = {
        run: { command: serverPath },
        debug: {
            command: serverPath
        }
    };
    const traceOutputChannel = vscode_1.window.createOutputChannel('Unimarkup Language Server Trace');
    let clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'unimarkup' }],
        traceOutputChannel
    };
    client = new node_1.LanguageClient('Unimarkup-LSP', 'Unimarkup LSP', serverOptions, clientOptions);
    client.start();
    client.onReady().then(() => {
        const disposablePreview = vscode_1.commands.registerCommand('um.preview', async () => {
            activePreviewPanel = await createPreview(context, getActiveUriFsPath());
        });
        context.subscriptions.push(disposablePreview);
    }).then(() => client.onNotification(new node_1.NotificationType('extension/renderedContent'), (data) => {
        if (data !== undefined) {
            const contentUri = vscode_1.Uri.parse(data.id.toString());
            renderedContents.set(contentUri.fsPath, getHtmlTemplate(data.content));
            updatePreview(contentUri.fsPath, getOrigEditor(contentUri.fsPath));
        }
    }));
    vscode_1.window.onDidChangeActiveTextEditor((activeEditor) => {
        let uriFsPath = activeEditor?.document.uri.fsPath;
        if (activeEditor?.document.languageId === 'unimarkup') {
            updatePreview(uriFsPath, activeEditor);
        }
    });
    vscode_1.window.registerWebviewPanelSerializer(PANEL_VIEW_TYPE, new PreviewSerializer());
}
exports.activate = activate;
function getServerPath() {
    const os = require('node:os');
    if (os.platform() === 'win32') {
        // Windows
        return "server_bin\\unimarkup_ls.exe";
    }
    else if (os.platform() === 'darwin') {
        // macOS
        return "server_bin/unimarkup_ls";
    }
    else {
        // Assume Linux for others
        return "server_bin/unimarkup_ls";
    }
}
function getOrigEditor(urifsPath) {
    for (const editor of vscode_1.window.visibleTextEditors) {
        if (editor.document.uri.fsPath === urifsPath) {
            return editor;
        }
    }
    return undefined;
}
function updatePreview(uriFsPath, origContentEditor) {
    if (uriFsPath === undefined) {
        return;
    }
    let previewPanel = findFirstMatchingPanel(previewPanels, uriFsPath);
    if (previewPanel !== undefined) {
        activePreviewPanel = previewPanel;
    }
    let content = renderedContents.get(uriFsPath);
    if (content !== undefined && activePreviewPanel !== undefined) {
        activePreviewPanel.id = uriFsPath;
        const html = getWebviewContent(content, new PreviewState(activePreviewPanel.id));
        console.log(html);
        activePreviewPanel.panel.webview.html = html;
        activePreviewPanel.panel.title = getPreviewTitle(uriFsPath);
    }
    if (origContentEditor !== undefined && activePreviewPanel.panel.viewColumn !== origContentEditor.viewColumn) {
        activePreviewPanel.panel.reveal(undefined, true);
    }
}
function deactivate() {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
exports.deactivate = deactivate;
class IdWebPanel {
    constructor(id, panel) {
        this.id = id;
        this.panel = panel;
        previewPanels.add(this);
        this.panel.onDidDispose(() => {
            previewPanels.delete(this);
        });
        this.panel.onDidChangeViewState((panelEvent) => {
            if (panelEvent.webviewPanel.active && this !== activePreviewPanel) {
                activePreviewPanel = this;
            }
        });
    }
}
function findFirstMatchingPanel(panels, id) {
    if (panels === undefined) {
        return undefined;
    }
    for (const panel of panels) {
        if (panel.id === id) {
            return panel;
        }
    }
    return undefined;
}
function getActiveUriFsPath() {
    let uri = vscode_1.window.activeTextEditor?.document.uri;
    if (uri === undefined) {
        return "";
    }
    else {
        return uri.fsPath;
    }
}
;
class PreviewSerializer {
    async deserializeWebviewPanel(webviewPanel, state) {
        let uriFsPath = state ? state.id : undefined;
        if (uriFsPath !== undefined) {
            let content = renderedContents.get(uriFsPath);
            if (content === undefined) {
                const fs = require('fs');
                if (fs.existsSync(uriFsPath)) {
                    vscode_1.workspace.openTextDocument(vscode_1.Uri.file(uriFsPath)); // Note: needed to start LSP rendering (somehow does not open the document though, which is convenient)
                    content = getHtmlTemplate("<p>Loading...</p>");
                }
                else {
                    content = getHtmlTemplate("<p>Original document does not exist anymore!</p>");
                }
            }
            webviewPanel.webview.html = getWebviewContent(content, new PreviewState(uriFsPath));
            let _ = new IdWebPanel(uriFsPath, webviewPanel);
        }
    }
}
async function createPreview(context, uriFsPath) {
    let content = renderedContents.get(uriFsPath);
    if (content === undefined) {
        content = getHtmlTemplate("<p>Loading</p>");
    }
    const panel = vscode_1.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Unimarkup Preview', vscode_1.ViewColumn.Two, {
        enableScripts: true,
    });
    panel.webview.html = getWebviewContent(content, new PreviewState(uriFsPath));
    panel.title = getPreviewTitle(uriFsPath);
    return new IdWebPanel(uriFsPath, panel);
}
function getPreviewTitle(uriFsPath) {
    let filename = path.parse(uriFsPath).base;
    if (filename === undefined) {
        return "Unimarkup Preview";
    }
    return "[Preview] " + filename;
}
class PreviewState {
    constructor(id) {
        this.id = id;
    }
}
function getWebviewContent(renderedPage, state) {
    let stateScript = `
    <script type="text/javascript">
      const vscode = acquireVsCodeApi();
      vscode.setState(${JSON.stringify(state)});

      window.addEventListener('message', event => {
        vscode.setState(event.data);
      })
    </script>
  `;
    let headEnd = renderedPage.indexOf("</head>");
    return renderedPage.substring(0, headEnd) + stateScript + renderedPage.substring(headEnd);
}
function getHtmlTemplate(body) {
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Preview</title>

    <style>
      .code-block pre {
        padding: 0.5em 1em;
      }
    </style>
  </head>
  <body>
    ${body}
  </body>
  </html>
  `;
}
//# sourceMappingURL=extension.js.map