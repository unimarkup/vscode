import path = require('path');
import { ExtensionContext, window, commands, WebviewPanel, Uri, ViewColumn, WebviewPanelSerializer, Webview, workspace, TextEditor } from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  NotificationType,
  ServerOptions
} from 'vscode-languageclient/node';

let client: LanguageClient;
const renderedContents = new Map<string, string>();

const PANEL_VIEW_TYPE = 'unimarkup.preview';
const previewPanels = new Set<IdWebPanel>();
let activePreviewPanel: IdWebPanel;

interface RenderedContent {
  id: Uri,
  content: string
}

export function activate(context: ExtensionContext) {
  let serverPath = getServerPath();
  serverPath = context.asAbsolutePath(serverPath);

  let serverOptions: ServerOptions = {
    run: { command: serverPath },
    debug: {
      command: serverPath
    }
  };

  const traceOutputChannel = window.createOutputChannel(
    'Unimarkup Language Server Trace',
  );

  let clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'unimarkup' }],
    traceOutputChannel
  };

  client = new LanguageClient(
    'Unimarkup-LSP',
    'Unimarkup LSP',
    serverOptions,
    clientOptions
  );

  client.start();

  client.onReady().then(
    () => {
      const disposablePreview = commands.registerCommand('um.preview', async () => {
        activePreviewPanel = await createPreview(context, getActiveUriFsPath());
      });

      context.subscriptions.push(disposablePreview);
    }
  ).then(
    () => client.onNotification(new NotificationType<RenderedContent>('extension/renderedContent'), (data: RenderedContent) => {
      if (data !== undefined) {
        const contentUri = Uri.parse(data.id.toString());
        renderedContents.set(contentUri.fsPath, getHtmlTemplate(data.content));

        updatePreview(contentUri.fsPath, getOrigEditor(contentUri.fsPath));
      }
    })
  );

  window.onDidChangeActiveTextEditor(
    (activeEditor) => {
      let uriFsPath = activeEditor?.document.uri.fsPath;

      if (activeEditor?.document.languageId === 'unimarkup') {
        updatePreview(uriFsPath, activeEditor);
      }
    }
  );

  window.registerWebviewPanelSerializer(PANEL_VIEW_TYPE, new PreviewSerializer());
}

function getServerPath(): string {
  const os = require('node:os');
  if (os.platform() === 'win32') {
    // Windows
    return "server_bin\\unimarkup_ls.exe";
  }
  else if (os.platform() === 'darwin') {
    // macOS
    return "server_bin/unimarkup_ls";
  } else {
    // Assume Linux for others
    return "server_bin/unimarkup_ls";
  }
}

function getOrigEditor(urifsPath: string): TextEditor | undefined {
  for (const editor of window.visibleTextEditors) {
    if (editor.document.uri.fsPath === urifsPath) {
      return editor;
    }
  }
  return undefined;
}

function updatePreview(uriFsPath: string | undefined, origContentEditor: TextEditor | undefined) {
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

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

class IdWebPanel {
  id: string;
  panel: WebviewPanel;

  constructor(id: string, panel: WebviewPanel) {
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

function findFirstMatchingPanel(panels: Set<IdWebPanel> | undefined, id: string): IdWebPanel | undefined {
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

function getActiveUriFsPath(): string {
  let uri = window.activeTextEditor?.document.uri;
  if (uri === undefined) {
    return "";
  } else {
    return uri.fsPath;
  }
};

class PreviewSerializer implements WebviewPanelSerializer {
  async deserializeWebviewPanel(webviewPanel: WebviewPanel, state: any) {
    let uriFsPath = state ? state.id : undefined;
    if (uriFsPath !== undefined) {
      let content = renderedContents.get(uriFsPath);
      if (content === undefined) {
        const fs = require('fs');
        if (fs.existsSync(uriFsPath)) {
          workspace.openTextDocument(Uri.file(uriFsPath)); // Note: needed to start LSP rendering (somehow does not open the document though, which is convenient)
          content = getHtmlTemplate("<p>Loading...</p>");
        } else {
          content = getHtmlTemplate("<p>Original document does not exist anymore!</p>");
        }
      }
      webviewPanel.webview.html = getWebviewContent(content, new PreviewState(uriFsPath));

      let _ = new IdWebPanel(uriFsPath, webviewPanel);
    }
  }
}

async function createPreview(context: ExtensionContext, uriFsPath: string): Promise<IdWebPanel> {
  let content = renderedContents.get(uriFsPath);
  if (content === undefined) {
    content = getHtmlTemplate("<p>Loading</p>");
  }

  const panel = window.createWebviewPanel(
    PANEL_VIEW_TYPE,
    'Unimarkup Preview',
    ViewColumn.Two,
    {
      enableScripts: true,
    }
  );

  panel.webview.html = getWebviewContent(content, new PreviewState(uriFsPath));
  panel.title = getPreviewTitle(uriFsPath);

  return new IdWebPanel(uriFsPath, panel);
}

function getPreviewTitle(uriFsPath: string): string {
  let filename = path.parse(uriFsPath).base;
  if (filename === undefined) {
    return "Unimarkup Preview";
  }
  return "[Preview] " + filename;
}

class PreviewState {
  id: string;

  constructor(id: string) {
    this.id = id;
  }
}


function getWebviewContent(renderedPage: string, state: PreviewState): string {
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

function getHtmlTemplate(body: string): string {
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

