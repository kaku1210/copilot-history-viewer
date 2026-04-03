import * as vscode from 'vscode';
import { DataStorageService } from './dataStorage';
import { HistoryWebviewProvider } from './webviewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Copilot History Viewer is now active');

    // 初始化数据服务
    const dataService = new DataStorageService(context);

    // 注册 WebView 侧边栏
    const provider = new HistoryWebviewProvider(context.extensionUri, dataService);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            HistoryWebviewProvider.viewType,
            provider
        )
    );

    // 注册刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand('copilotHistory.refresh', () => {
            provider.refresh();
        })
    );

    // 注册打开设置命令
    context.subscriptions.push(
        vscode.commands.registerCommand('copilotHistory.openSettings', () => {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'copilotHistoryViewer'
            );
        })
    );

    // 显示存储路径信息
    const storagePath = context.globalStorageUri.fsPath;
    console.log(`[Copilot History] Data stored at: ${storagePath}`);
}

export function deactivate() {
    console.log('Copilot History Viewer deactivated');
}
