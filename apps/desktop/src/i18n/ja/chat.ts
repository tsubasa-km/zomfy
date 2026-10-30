// Japanese for the chat area, keyed by the English text as the code writes it.
export const CHAT: Record<string, string> = {
  // agent-notifications.ts
  workspace: 'ワークスペース',
  'Claude needs you · {workspace}': 'Claude が対応を待っています · {workspace}',
  'Claude stopped with an error · {workspace}': 'Claude がエラーで停止しました · {workspace}',
  'Claude finished · {workspace}': 'Claude が完了しました · {workspace}',
  'Usage limit reset: resumed · {workspace}': '使用量の上限がリセットされ、再開しました · {workspace}',

  // chat-actions.ts
  "Couldn't change that option: {error}": 'このオプションを変更できませんでした: {error}',
  'Forking works in Claude chats only': 'フォークは Claude のチャットでのみ使用できます',
  "Couldn't fork this chat: {error}": 'このチャットをフォークできませんでした: {error}',
  "Couldn't pick this chat back up": 'このチャットを再開できませんでした',
  "Couldn't change automatic resume": '自動再開の設定を変更できませんでした',

  // chat-rename-archive.ts
  "This chat's host runs an older daemon; update Zomfy there first.": 'このチャットのホストでは古いデーモンが動いています。先にそのホストの Zomfy を更新してください。',
  "Couldn't rename the chat": 'チャットの名前を変更できませんでした',
  "Couldn't archive the chat": 'チャットをアーカイブできませんでした',
  "Couldn't unarchive the chat": 'チャットのアーカイブを解除できませんでした',

  // components/editor/BinaryFileView.tsx
  'Reload from Disk': 'ディスクから再読み込み',
  'Loading preview...': 'プレビューを読み込み中...',

  // components/editor/ConflictBanner.tsx
  'Unresolved conflict · Resolve the conflict markers': '未解決の競合 · 競合マーカーを解消してください',
  'Resolved locally': 'ローカルで解決済み',
  'Accept All Current': '現在の変更をすべて採用',
  'Accept All Incoming': '入力側の変更をすべて採用',
  'Previous conflict': '前の競合',
  'Next conflict': '次の競合',
  'Mark as Resolved': '解決済みにする',
  'No conflict markers remain. Save, then stage the file to tell Git the conflict is resolved.': '競合マーカーは残っていません。保存してからファイルをステージすると、競合の解決が Git に伝わります。',

  // components/editor/DiffReviewNotes.tsx
  'Lines {start}-{end}': '{start}〜{end} 行目',
  'Line {line}': '{line} 行目',
  'Add note for the AI': 'AI へのメモを追加',
  'Add note': 'メモを追加',
  Sent: '送信済み',
  'Edit note': 'メモを編集',
  'Delete note': 'メモを削除',

  // components/editor/EditorPanelHeader.tsx
  'File path copied': 'ファイルパスをコピーしました',
  'File actions': 'ファイルの操作',

  // components/editor/EditorViewToggle.tsx
  Source: 'ソース',
  'Source and Preview': 'ソースとプレビュー',
  Preview: 'プレビュー',

  // components/editor/ExternalFileChangeBanner.tsx
  'This file was deleted on disk while you have unsaved edits. Saving will recreate it.': '未保存の編集があるまま、このファイルがディスク上で削除されました。保存するとファイルが作り直されます。',
  'This file changed on disk while you have unsaved edits. Saving will overwrite the newer disk content.': '未保存の編集があるまま、このファイルがディスク上で変更されました。保存するとディスク上の新しい内容が上書きされます。',
  Compare: '比較',
  'Keep My Edits': '自分の編集を残す',

  // components/editor/ExternalFileChangeCompareDialog.tsx
  'Compare with Disk': 'ディスクと比較',
  'Left is the newer content on disk; right is your unsaved edits.': '左がディスク上の新しい内容、右が未保存の編集です。',

  // components/editor/ImageDiffViewer.tsx
  Original: '変更前',
  Modified: '変更後',
  'No preview': 'プレビューなし',

  // components/editor/ImageViewer.tsx
  'Failed to load file preview': 'ファイルのプレビューを読み込めませんでした',
  'Zoom out': '縮小',
  'Reset zoom': 'ズームをリセット',
  'Zoom in': '拡大',

  // components/editor/PdfViewer.tsx
  'Failed to decode PDF content': 'PDF の内容をデコードできませんでした',
  'This PDF is password-protected': 'この PDF はパスワードで保護されています',
  'Failed to load PDF preview': 'PDF のプレビューを読み込めませんでした',
  'Fit to width': '幅に合わせる',
  'Find in PDF (Ctrl+F)': 'PDF 内を検索 (Ctrl+F)',
  'Find in PDF': 'PDF 内を検索',
  '{n} page · PDF preview': '{n} ページ · PDF プレビュー',
  '{n} pages · PDF preview': '{n} ページ · PDF プレビュー',
  'PDF preview': 'PDF プレビュー',
  '{current} of {total}': '{current} / {total}',
  'Close find': '検索を閉じる',

  // components/editor/monaco-conflict-decorations.ts
  'Current change': '現在の変更',
  'Common ancestor': '共通の祖先',
  'Incoming change': '入力側の変更',
  'End conflict': '競合の終わり',

  // components/editor/rich-markdown-code-block-languages.ts
  'Plain text': 'プレーンテキスト',

  // components/editor/use-monaco-conflicts.ts
  'Accept Current Change': '現在の変更を採用',
  'Accept Incoming Change': '入力側の変更を採用',
  'Accept Both Changes': '両方の変更を採用',

  // components/markdown-editor/markdown-live-preview.ts
  'Completed task': '完了したタスク',
  Task: 'タスク',

  // components/native-chat/NativeChatAgentOptionPickers.tsx
  'Search models…': 'モデルを検索…',
  'No models match your search.': '一致するモデルはありません。',

  // components/native-chat/NativeChatApprovalCard.tsx
  'Allow {action}?': '{action} を許可しますか？',

  // components/native-chat/NativeChatAttachMenu.tsx
  Attach: '添付',
  'Image…': '画像…',
  'File in this workspace…': 'このワークスペースのファイル…',
  Chat: 'チャット',
  'No other chats': '他のチャットはありません',
  Terminal: 'ターミナル',
  'No terminals open': '開いているターミナルはありません',
  'Run in chat': 'チャット内で実行',

  // components/native-chat/NativeChatAutocompleteMenus.tsx
  'Loading files...': 'ファイルを読み込み中...',
  "Couldn't load files": 'ファイルを読み込めませんでした',
  'No matching files': '一致するファイルはありません',
  Commands: 'コマンド',
  'Skills and custom commands': 'スキルとカスタムコマンド',
  'Loading commands...': 'コマンドを読み込み中...',
  "Couldn't load commands": 'コマンドを読み込めませんでした',
  'No matching commands': '一致するコマンドはありません',

  // components/native-chat/NativeChatCodeBlock.tsx
  'Copy code': 'コードをコピー',
  'Disable line wrap': '折り返しを解除',
  'Wrap lines': '行を折り返す',

  // components/native-chat/NativeChatComposer.tsx
  'The workflow did not start': 'ワークフローを開始できませんでした',
  'Reconnecting to {host}… You can keep writing; sending waits until it is back.': '{host} に再接続しています… 入力は続けられます。送信は再接続を待って行われます。',
  Attachments: '添付ファイル',
  'Image {n}': '画像 {n}',
  'Remove image': '画像を削除',
  'Reconnecting to {host}… sending waits until it is back': '{host} に再接続しています… 送信は再接続を待って行われます',
  'The task for "{name}"': '「{name}」のタスク',
  'Queue a follow-up': '続けて送るメッセージをキューに追加',
  'Message the agent': 'エージェントにメッセージ',
  'Suggestion: {suggestion}. Press Tab to use it.': '候補: {suggestion}。Tab キーで使用します。',
  'Starting…': '起動中…',
  'Stop the agent': 'エージェントを停止',
  Send: '送信',
  'Reconnecting to {host}…': '{host} に再接続しています…',
  'Send ({key})': '送信 ({key})',

  // components/native-chat/NativeChatContextUsageRing.tsx
  'Context {used} of {window} tokens, {percentage}% used': 'コンテキスト {used} / {window} トークン（{percentage}% 使用）',
  Context: 'コンテキスト',
  'Session cost ${cost}': 'セッションの費用 ${cost}',
  'Estimated from the last response.': '直前の応答からの推定値です。',

  // components/native-chat/NativeChatCopyButton.tsx
  Copied: 'コピーしました',
  'Copy message': 'メッセージをコピー',

  // components/native-chat/NativeChatDictationButton.tsx
  'Microphone unavailable': 'マイクを使用できません',
  'Stop dictation ({seconds}s)': '音声入力を停止（{seconds} 秒）',
  'Transcribing…': '文字起こし中…',
  'Dictation: {message}': '音声入力: {message}',
  Dictate: '音声入力',

  // components/native-chat/NativeChatEmptyState.tsx
  'just now': 'たった今',
  '{n}m ago': '{n} 分前',
  '{n}h ago': '{n} 時間前',
  '{n}d ago': '{n} 日前',
  'Start a conversation with {label}': '{label} との会話を始めましょう',
  'Type / for commands, @ to mention a file, or paste an image.': '/ でコマンド、@ でファイルを参照できます。画像も貼り付けられます。',
  'Starting {label}…': '{label} を起動中…',
  '{label} could not start': '{label} を起動できませんでした',
  'Recent conversations': '最近の会話',
  Open: '開く',
  "Couldn't list earlier conversations": '以前の会話を一覧表示できませんでした',

  // components/native-chat/NativeChatFindBar.tsx
  'No results': '結果なし',
  'Find in chat': 'チャット内を検索',
  'Previous match': '前の一致',
  'Next match': '次の一致',
  Close: '閉じる',

  // components/native-chat/NativeChatForkMenuItem.tsx
  'Fork Chat': 'チャットをフォーク',
  'Claude only': 'Claude のみ',

  // components/native-chat/NativeChatInlineTerminal.tsx
  ' · ended when the app closed': ' · アプリの終了時に終了',
  ' · exited {code}': ' · 終了コード {code}',
  'Attach output to message': '出力をメッセージに添付',
  'Attach output to message as a file (the agent reads it only after you send)': '出力をファイルとしてメッセージに添付します（エージェントが読むのは送信後です）',
  'Open as tab': 'タブとして開く',
  'Close terminal': 'ターミナルを閉じる',

  // components/native-chat/NativeChatJumpToLatest.tsx
  'Jump to latest': '最新へ移動',

  // components/native-chat/NativeChatMarkdown.tsx
  '{kind}: click to open': '{kind}: クリックして開く',

  // components/native-chat/NativeChatMemoPanel.tsx
  'Close chat memo': 'チャットのメモを閉じる',
  'Chat memo': 'チャットのメモ',
  'Chat memo (has notes)': 'チャットのメモ（記入あり）',
  'Loading…': '読み込み中…',
  'Not saved': '未保存',
  'Saving…': '保存中…',
  Saved: '保存済み',
  Memo: 'メモ',
  'Close memo': 'メモを閉じる',
  'Notes for this chat. Markdown works; only you see them.': 'このチャット用のメモです。Markdown が使えます。表示されるのはあなただけです。',

  // components/native-chat/NativeChatMessageRail.tsx
  'Your messages': '自分のメッセージ',
  Message: 'メッセージ',

  // components/native-chat/NativeChatPermissionModePicker.tsx
  Plan: 'プラン',
  'Explores and plans; changes nothing until you approve the plan': '調査して計画を立てます。プランを承認するまで何も変更しません',
  'Ask for approval': '承認を求める',
  "Asks before edits and commands your settings don't allow": '設定で許可されていない編集やコマンドの前に確認します',
  'Accept edits': '編集を自動承認',
  'Approves file edits and file commands; asks for the rest': 'ファイルの編集とファイル操作コマンドを承認し、それ以外は確認します',
  Auto: '自動',
  "Claude Code's auto mode: reviews approval requests for you": 'Claude Code の自動モード: 承認リクエストを代わりに審査します',
  'Full access': 'フルアクセス',
  'Never asks before edits or commands': '編集やコマンドの前に確認しません',
  Permissions: '権限',

  // components/native-chat/NativeChatQueuedMessageList.tsx
  'Paused · {reason}': '一時停止中 · {reason}',
  Paused: '一時停止中',
  Queued: 'キュー',
  'Clear all': 'すべてクリア',
  Resume: '再開',
  Collapse: '折りたたむ',
  Expand: '展開',
  'Queued messages': 'キュー内のメッセージ',
  'Send now (interrupts the agent)': '今すぐ送信（エージェントを中断します）',
  'Send now': '今すぐ送信',
  Delete: '削除',

  // components/native-chat/NativeChatRunCommandButton.tsx
  'Run in terminal ({shell})': 'ターミナルで実行（{shell}）',

  // components/native-chat/NativeChatSelectionQuote.tsx
  'Add to chat': 'チャットに追加',
  'Ask in side chat': 'サイドチャットで質問',

  // components/native-chat/NativeChatSessionOptionPicker.tsx
  Low: '低',
  Medium: '中',
  High: '高',
  'Extra high': '特高',
  Max: '最大',
  Med: '中',
  XHigh: '特高',
  Model: 'モデル',
  'Model {model}, Effort {effort}': 'モデル {model}、思考量 {effort}',
  'Model {model}': 'モデル {model}',
  'Loading models…': 'モデルを読み込み中…',
  Effort: '思考量',

  // components/native-chat/NativeChatSubagentRun.tsx
  Working: '作業中',
  Done: '完了',
  Failed: '失敗',
  Subagent: 'サブエージェント',
  ' · {n} call': ' · {n} 回の呼び出し',
  ' · {n} calls': ' · {n} 回の呼び出し',

  // components/native-chat/NativeChatTaskList.tsx
  Completed: '完了',
  'In progress': '進行中',
  Pending: '未着手',
  'No tasks': 'タスクはありません',
  Tasks: 'タスク',
  '{completed} of {total} tasks completed': '{total} 件中 {completed} 件のタスクが完了',
  'Tasks unchanged': 'タスクの変更なし',
  'Full task list': 'タスクの一覧',

  // components/native-chat/NativeChatToolGroup.tsx
  'ran {n} command': '{n} 件のコマンドを実行',
  'ran {n} commands': '{n} 件のコマンドを実行',
  'read {n} file': '{n} 件のファイルを読み取り',
  'read {n} files': '{n} 件のファイルを読み取り',
  'edited {n} file': '{n} 件のファイルを編集',
  'edited {n} files': '{n} 件のファイルを編集',
  'deleted {n} file': '{n} 件のファイルを削除',
  'deleted {n} files': '{n} 件のファイルを削除',
  'moved {n} file': '{n} 件のファイルを移動',
  'moved {n} files': '{n} 件のファイルを移動',
  'searched {n} time': '{n} 回検索',
  'searched {n} times': '{n} 回検索',
  'fetched {n} page': '{n} 件のページを取得',
  'fetched {n} pages': '{n} 件のページを取得',
  'ran {n} agent': '{n} 件のエージェントを実行',
  'ran {n} agents': '{n} 件のエージェントを実行',
  '{n} other step': 'その他 {n} 件のステップ',
  '{n} other steps': 'その他 {n} 件のステップ',
  ', ': '、',
  Allowed: '許可',
  Rejected: '拒否',
  Expired: '期限切れ',
  '{n} failed': '{n} 件失敗',

  // components/native-chat/NativeChatTranscriptRow.tsx
  'Fork from here': 'ここからフォーク',
  'Context compacted': 'コンテキストを圧縮しました',
  'Compacting context…': 'コンテキストを圧縮中…',
  'Compaction failed': '圧縮に失敗しました',
  'Rewind to here': 'ここまで巻き戻す',
  Thinking: '思考',

  // components/native-chat/NativeChatTurnDiffRollup.tsx
  'Hide diff': '差分を隠す',
  'Show diff': '差分を表示',
  '1 changed file': '1 件のファイルを変更',
  '{n} changed files': '{n} 件のファイルを変更',

  // components/native-chat/NativeChatTurnRecovery.tsx
  'Continue, and the agent first checks whether its last step finished.': '続行します。エージェントはまず直前のステップが完了したかを確認します。',
  Continue: '続行',
  Retry: '再試行',
  Continued: '続行しました',
  Retried: '再試行しました',
  'Resumed after the usage limit': '使用量の上限の後に再開しました',
  'Resumed automatically after the usage limit reset': '使用量の上限のリセット後に自動で再開しました',
  'Continued in the new workspace': '新しいワークスペースで続行しました',
  '{d}d {h}h': '{d}日 {h}時間',
  '{h}h {m}m': '{h}時間 {m}分',
  'Resuming automatically in {time}': '{time} 後に自動で再開します',
  'Reset time unknown: trying again in {time} (every 15–60 min)': 'リセット時刻は不明です: {time} 後に再試行します（15〜60 分ごと）',
  'Resuming…': '再開中…',
  'Resets at {clock} (in {time})': '{clock} にリセット（あと {time}）',
  'The limit should have reset by now': '上限はすでにリセットされているはずです',
  'Claude did not say when the limit resets': 'Claude から上限のリセット時刻が示されませんでした',
  'Claude usage limit reached': 'Claude の使用量の上限に達しました',
  'Resume automatically when the limit resets': '上限がリセットされたら自動で再開',

  // components/native-chat/NativeChatWorkflowPicker.tsx
  'Workflow: {name}': 'ワークフロー: {name}',
  'Run a workflow': 'ワークフローを実行',
  'Clear the workflow': 'ワークフローを解除',
  'Run a workflow on this message': 'このメッセージでワークフローを実行',
  'No workflows in this project yet.': 'このプロジェクトにはまだワークフローがありません。',
  'Edit workflows…': 'ワークフローを編集…',

  // components/native-chat/NativeChatWorkflowRunCard.tsx
  Running: '実行中',
  'Waiting for you': '対応待ち',
  Stopped: '停止',
  'Loading the workflow run…': 'ワークフローの実行を読み込み中…',
  'The run did not take that': '実行に反映できませんでした',
  'A note for the next round, or "stop"': '次のラウンドへのメモ、または "stop"',
  'Your answer': '回答',
  Answer: '回答',
  'Open the run': '実行を開く',
  Stop: '停止',

  // components/native-chat/native-chat-command-run.ts
  'PowerShell is not available on this host': 'このホストでは PowerShell を使用できません',
  'Command Prompt is only available on Windows hosts': 'コマンド プロンプトは Windows ホストでのみ使用できます',
  'No POSIX shell on this host (install Git for Windows for Git Bash)': 'このホストには POSIX シェルがありません（Git Bash を使うには Git for Windows をインストールしてください）',

  // components/native-chat/native-chat-task-list.ts
  'Added {task}': '追加: {task}',
  'Removed {task}': '削除: {task}',
  'Started {task}': '開始: {task}',
  'Completed {task}': '完了: {task}',
  'Marked pending: {task}': '未着手に戻す: {task}',
  'Updated {task}': '更新: {task}',

  // components/native-chat/native-chat-task-notification.ts
  'Background task finished': 'バックグラウンドタスクが終了しました',

  // components/native-chat/native-chat-transcript-model.ts
  'Task {id}': 'タスク {id}',

  // components/tab-layout/BrowserTabView.tsx
  Back: '戻る',
  Forward: '進む',
  Reload: '再読み込み',
  Address: 'アドレス',
  'Search or enter URL': '検索または URL を入力',
  'Open In Browser': 'ブラウザーで開く',
  'Type an address or a search above. Sites that refuse to be embedded stay blank here; open them in your browser instead.': '上でアドレスか検索語を入力してください。埋め込みを拒否するサイトはここでは空白のままになるため、ブラウザーで開いてください。',

  // components/tab-layout/NewTabMenu.tsx
  'New Claude Chat': '新しい Claude チャット',
  'New {agent} Chat': '新しい {agent} チャット',
  'New Terminal ({shell})': '新しいターミナル ({shell})',
  'New Browser Tab': '新しいブラウザータブ',
  'New tab': '新しいタブ',

  // components/tab-layout/TabContextMenu.tsx
  None: 'なし',
  Blue: '青',
  Purple: '紫',
  Pink: 'ピンク',
  Red: '赤',
  Orange: 'オレンジ',
  Yellow: '黄',
  Green: '緑',
  Teal: '青緑',
  Gray: 'グレー',
  Right: '右',
  Left: '左',
  Down: '下',
  Up: '上',
  'Move Tab to Split': 'タブを分割先へ移動',
  'Duplicate Tab': 'タブを複製',
  'Unarchive Chat': 'チャットのアーカイブを解除',
  'Archive Chat': 'チャットをアーカイブ',
  'Unpin Tab': 'タブのピン留めを外す',
  'Pin Tab': 'タブをピン留め',
  'Copy Tab ID': 'タブ ID をコピー',
  'Close {n} Selected Tabs': '選択した {n} 個のタブを閉じる',
  'Close Others': '他を閉じる',
  'Close All Editor Tabs': 'すべてのエディタータブを閉じる',
  'Close Tabs To The Right': '右側のタブを閉じる',
  'Close Tabs To The Left': '左側のタブを閉じる',
  'Copy Path': 'パスをコピー',
  'Copy Relative Path': '相対パスをコピー',
  'Change Title': 'タイトルを変更',
  'Tab Color': 'タブの色',

  // components/tab-layout/TabGroupPane.tsx
  'New split': '新しい分割',

  // components/tab-layout/TabItem.tsx
  'Rename tab {title}': 'タブ「{title}」の名前を変更',
  'Unsaved changes': '未保存の変更',
  'Close {title}': '{title} を閉じる',

  // components/tab-layout/TabOmnibox.tsx
  'Search open tabs, files, URLs, agents…': '開いているタブ、ファイル、URL、エージェントを検索…',
  'Switch to tab': 'タブに切り替え',
  'Launch agent': 'エージェントを起動',
  'Open file': 'ファイルを開く',
  'Open URL': 'URL を開く',
  'Search Google': 'Google で検索',

  // components/tab-layout/TabStrip.tsx
  'Scroll tabs left': 'タブを左へスクロール',
  'Scroll tabs right': 'タブを右へスクロール',
  'Pane Actions': 'ペインの操作',
  'Close split pane': '分割ペインを閉じる',

  // components/tab-layout/ToolDrawer.tsx
  Explorer: 'エクスプローラー',
  Search: '検索',
  'Source Control': 'ソース管理',
  Checks: 'チェック',
  Ports: 'ポート',
  'Side chat': 'サイドチャット',
  Agent: 'エージェント',
  '{n} terminal': 'ターミナル {n} 個',
  '{n} terminals': 'ターミナル {n} 個',
  '{n} browser': 'ブラウザー {n} 個',
  '{n} browsers': 'ブラウザー {n} 個',
  'New terminal or browser': '新しいターミナルまたはブラウザー',
  Browser: 'ブラウザー',
  Unpin: 'ピン留めを外す',
  'Keep open': '開いたままにする',

  // components/tab-layout/pane-split-commands.ts
  'Split terminal right': 'ターミナルを右に分割',
  'Split terminal down': 'ターミナルを下に分割',
  'Close active pane': 'アクティブなペインを閉じる',
  'Focus next pane': '次のペインにフォーカス',
  'Focus previous pane': '前のペインにフォーカス',
  'Equalize pane sizes': 'ペインのサイズを均等にする',
  'Expand / collapse pane': 'ペインを最大化 / 元に戻す',
  'Terminal Panes': 'ターミナルのペイン',

  // components/tab-layout/terminal-commands.tsx
  "Couldn't open a terminal": 'ターミナルを開けませんでした',
  'New Terminal': '新しいターミナル',
  'New terminal ({shortcut})': '新しいターミナル ({shortcut})',
  'New terminal': '新しいターミナル',
  Tabs: 'タブ',

  // components/tab-layout/use-tab-keyboard.tsx
  'Switch tabs': 'タブを切り替え',
  'Switch Tab': 'タブを切り替え',

  // components/tab-layout/workspace-tab-model.ts
  'Discard unsaved changes?\n\n{names}': '未保存の変更を破棄しますか？\n\n{names}',

  // components/terminal/AgentLaunchDialog.tsx
  'Launch Agent': 'エージェントを起動',
  'Starts the agent in a new terminal tab with this as its first prompt.': '新しいターミナルタブでエージェントを起動し、これを最初のプロンプトとして渡します。',
  'Choose agent': 'エージェントを選択',
  Prompt: 'プロンプト',
  'Ask the agent to investigate this workspace': 'このワークスペースの調査をエージェントに依頼',
  Cancel: 'キャンセル',
  Launch: '起動',

  // components/terminal/AgentLaunchMenuItems.tsx
  Agents: 'エージェント',
  'Looking for agents…': 'エージェントを探しています…',
  'Can’t reach this workspace’s host to list its agents': 'このワークスペースのホストに接続できず、エージェントを一覧表示できません',
  'No agents detected': 'エージェントが見つかりません',
  'Launch {agent} in a new terminal': '新しいターミナルで {agent} を起動',
  'Launch Agent with Prompt…': 'プロンプトを指定してエージェントを起動…',
  'Refresh Agents': 'エージェントを再検出',

  // components/terminal/QuickCommandDialog.tsx
  'Edit Quick Command': 'クイックコマンドを編集',
  'Add Quick Command': 'クイックコマンドを追加',
  'Saved items appear in the tab bar menu for one-click run.': '保存した項目はタブバーのメニューに表示され、ワンクリックで実行できます。',
  Label: 'ラベル',
  'Start dev server': '開発サーバーを起動',
  Action: 'アクション',
  'Terminal Command': 'ターミナルのコマンド',
  'Agent Prompt': 'エージェントへのプロンプト',
  Command: 'コマンド',
  'Multi-line prompts are fine — keep them focused.': '複数行のプロンプトも使えます。要点を絞って書いてください。',
  'Toggle append Enter': 'Enter の付加を切り替え',
  'Append Enter — run immediately': 'Enter を付加 — すぐに実行',
  'Drag corner to resize': '角をドラッグしてサイズを変更',
  Scope: '範囲',
  Global: 'グローバル',
  Project: 'プロジェクト',
  'Save ({shortcut})': '保存 ({shortcut})',
  Save: '保存',

  // components/terminal/QuickCommandsButton.tsx
  'Add quick command': 'クイックコマンドを追加',
  'Save a quick command for this project': 'このプロジェクト用のクイックコマンドを保存',
  'Save a quick command for this workspace': 'このワークスペース用のクイックコマンドを保存',
  'Quick command actions': 'クイックコマンドの操作',
  'Edit {label}': '{label} を編集',
  'Remove {label}': '{label} を削除',
  'Run quick command: {label}': 'クイックコマンドを実行: {label}',
  'Run quick command': 'クイックコマンドを実行',
  Run: '実行',
  'Start {agent}: {prompt}': '{agent} を起動: {prompt}',
  'Run: {command}': '実行: {command}',
  'More quick commands': 'その他のクイックコマンド',
  'Search quick commands...': 'クイックコマンドを検索...',
  'No commands match': '一致するコマンドはありません',
  'No commands': 'コマンドはありません',

  // components/terminal/SetTerminalTitleDialog.tsx
  'Set Terminal Title': 'ターミナルのタイトルを設定',
  'Terminal title': 'ターミナルのタイトル',
  'Leave empty to follow the running program': '空欄にすると実行中のプログラムに従います',

  // components/terminal/TerminalContextMenu.tsx
  Copy: 'コピー',
  'Select All': 'すべて選択',
  Paste: '貼り付け',
  Find: '検索',
  'Quick Commands': 'クイックコマンド',
  'No quick commands': 'クイックコマンドはありません',
  'Add Quick Command…': 'クイックコマンドを追加…',
  'Split Terminal Right': 'ターミナルを右に分割',
  'Split Terminal Down': 'ターミナルを下に分割',
  'Set Title…': 'タイトルを設定…',
  'Clear Title': 'タイトルをクリア',
  'Copy Terminal ID': 'ターミナル ID をコピー',
  'Close Terminal': 'ターミナルを閉じる',
  'Clear Screen': '画面をクリア',
  'Reset Terminal': 'ターミナルをリセット',
  'Restart Terminal': 'ターミナルを再起動',
  Insert: '挿入',

  // components/terminal/TerminalPaneTree.tsx
  'Starting terminal…': 'ターミナルを起動中…',

  // components/terminal/TerminalProcessExitOverlay.tsx
  'Terminal exited': 'ターミナルが終了しました',
  'The shell process ended with exit code {code}. Its output is preserved.': 'シェルのプロセスが終了コード {code} で終了しました。出力は残っています。',
  Restart: '再起動',

  // components/terminal/TerminalSearch.tsx
  'Search...': '検索...',
  'Case sensitive': '大文字と小文字を区別',
  Regex: '正規表現',

  // components/ui/command.tsx
  'Command Palette': 'コマンドパレット',
  'Search for a command to run...': '実行するコマンドを検索...',

  // components/ui/dialog.tsx
  Minimize: '最小化',

  // daemon-connection.ts
  'Could not reach the daemon': 'デーモンに接続できませんでした',
  '{host} needs the desktop app': '{host} にはデスクトップアプリが必要です',
  'Lost contact with the daemon; it may still be running there': 'デーモンとの接続が切れました。デーモン自体はまだ動作している可能性があります',
  'The daemon there had exited (its terminals and agent turns ended); a new one was started.': 'そのホストのデーモンは終了していました（ターミナルとエージェントのターンも終了しています）。新しいデーモンを起動しました。',
  'Not connected to {host}': '{host} に接続されていません',
  '{error}: not sent. Your message is back in the box.': '{error}: 送信されませんでした。メッセージは入力欄に戻してあります。',
  'Tool call': 'ツールの呼び出し',

  // session-store.ts
  'This computer': 'このコンピューター',
  'Worked for {seconds}s': '{seconds} 秒間作業しました',
  Tool: 'ツール'
}
