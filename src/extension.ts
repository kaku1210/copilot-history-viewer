import * as vscode from 'vscode';
import { DataStorageService } from './dataStorage';
import { HistoryWebviewProvider } from './webviewProvider';
import { ProjectStorageService } from './projectStorageService';
import { ChangeTrackingService } from './changeTrackingService';

let projectStorageService: ProjectStorageService;
let changeTrackingService: ChangeTrackingService;

export function activate(context: vscode.ExtensionContext) {
    console.log('Copilot History Viewer is now active');

    // 初始化数据服务
    const dataService = new DataStorageService(context);

    // 初始化项目级存储服务
    projectStorageService = new ProjectStorageService(
        vscode.workspace.workspaceFolders?.[0]?.uri
    );

    // 初始化变更追踪服务
    changeTrackingService = new ChangeTrackingService(projectStorageService);

    // 注册 WebView 侧边栏
    const provider = new HistoryWebviewProvider(
        context.extensionUri,
        dataService,
        projectStorageService,
        changeTrackingService
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            HistoryWebviewProvider.viewType,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // 监听 Copilot .jsonl 文件变化，有新对话时自动刷新
    const storagePaths = dataService.getWatchPaths();
    if (storagePaths.length > 0) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                vscode.Uri.file(storagePaths[0]),
                '**/*.jsonl'
            )
        );
        const onFileChange = () => {
            provider.refreshIncremental();
            
            // 同步到项目存储
            if (projectStorageService.isEnabled()) {
                dataService.loadCopilotSessions().then(sessions => {
                    projectStorageService.syncSessionsFromGlobal(sessions);
                });
            }
        };
        watcher.onDidCreate(onFileChange, null, context.subscriptions);
        watcher.onDidChange(onFileChange, null, context.subscriptions);
        context.subscriptions.push(watcher);
    }

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

    // 注册切换项目级存储命令
    context.subscriptions.push(
        vscode.commands.registerCommand('copilotHistory.toggleProjectSync', async () => {
            const config = vscode.workspace.getConfiguration('copilotHistoryViewer');
            const currentValue = config.get<boolean>('enableProjectSync', false);
            await config.update('enableProjectSync', !currentValue, vscode.ConfigurationTarget.Workspace);
            
            if (!currentValue) {
                // 启用时，立即同步一次
                const sessions = await dataService.loadCopilotSessions();
                projectStorageService.syncSessionsFromGlobal(sessions);
                vscode.window.showInformationMessage('项目级存储已启用，已同步当前会话');
            } else {
                vscode.window.showInformationMessage('项目级存储已禁用');
            }

            provider.refresh();
        })
    );

    // 注册切换变更追踪命令
    context.subscriptions.push(
        vscode.commands.registerCommand('copilotHistory.toggleChangeTracking', async () => {
            const config = vscode.workspace.getConfiguration('copilotHistoryViewer');
            const currentValue = config.get<boolean>('enableChangeTracking', false);
            await config.update('enableChangeTracking', !currentValue, vscode.ConfigurationTarget.Workspace);
            
            if (!currentValue) {
                changeTrackingService.startTracking();
                vscode.window.showInformationMessage('代码变更追踪已启用');
            } else {
                changeTrackingService.stopTracking();
                vscode.window.showInformationMessage('代码变更追踪已禁用');
            }

            provider.refresh();
        })
    );

    // 注册标记人工编辑命令
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'copilotHistory.markManualEdit',
            (filePath: string, startLine: number, endLine: number) => {
                changeTrackingService.markManualEdit(filePath, startLine, endLine);
                vscode.window.showInformationMessage('已标记为人工编辑');
            }
        )
    );

    // 如果启用了变更追踪，立即开始监听
    if (projectStorageService.isChangeTrackingEnabled()) {
        changeTrackingService.startTracking();
    }

    // 显示存储路径信息
    const storagePath = context.globalStorageUri.fsPath;
    const projectLogPath = projectStorageService.getProjectLogDir();
    console.log(`[Copilot History] Global storage: ${storagePath}`);
    console.log(`[Copilot History] Project log: ${projectLogPath}`);
}

export function deactivate() {
    // 保存当前会话
    if (changeTrackingService) {
        changeTrackingService.stopTracking();
    }
    console.log('Copilot History Viewer deactivated');
}
