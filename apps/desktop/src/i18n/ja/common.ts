// Japanese for words shared across the app and for the language setting itself.
export const COMMON: Record<string, string> = {
  Language: '言語',
  'The language Zomfy is shown in. The window reloads to switch.': 'Zomfy の表示言語です。切り替えるとウィンドウを再読み込みします。',
  'Same as the system': 'システムに合わせる',

  // Language servers (lib/lsp, components/settings/LanguageServerSettings.tsx)
  'Language servers': '言語サーバー',
  'No language server for these files on {host}': '{host} にこの種類のファイル用の言語サーバーがありません',
  'Completion and diagnostics need {name}. To install it there: {command}': '補完と診断には {name} が必要です。そのホストでのインストール方法: {command}',
  '{name} is not running on {host}': '{name} は {host} で動いていません',
  '{name} could not rename this': '{name} はこの名前を変更できませんでした',
  'Nothing to rename here': 'ここには名前を変更できるものがありません',
  'That is outside the workspace': 'ワークスペースの外にあります',
  '{path} cannot be opened in a tab. Peek shows it in place.': '{path} はタブで開けません。ピーク表示ならその場で見られます。',
  '{file} is outside the workspace and was left alone': '{file} はワークスペースの外にあるため変更していません',
  '{file} is too large or not text, so it was left alone': '{file} は大きすぎるかテキストではないため変更していません',
  '{file} could not be moved to the trash, so it was not deleted': '{file} をごみ箱に移動できなかったため削除していません',
  '{action} was not fully applied': '「{action}」をすべては適用できませんでした',
  'The edit was not fully applied': '編集をすべては適用できませんでした',
  '{n} file that was not open was changed and saved': '開いていなかったファイル {n} 件を変更して保存しました',
  '{n} files that were not open were changed and saved': '開いていなかったファイル {n} 件を変更して保存しました',
  'Undo covers only the files open in the editor.': '元に戻せるのはエディターで開いているファイルだけです。',
  Linter: 'リンター',
  'Use {name}': '{name} を使う',
  'To install it on this host: {command}': 'このホストへのインストール方法: {command}',
  '{name} command': '{name} のコマンド',
  'Starts this language server over stdio. Empty looks for it on the host.': 'この言語サーバーを標準入出力で起動するコマンドです。空欄ならホスト上から探します。',
  'Starts this language server over stdio.': 'この言語サーバーを標準入出力で起動するコマンドです。',
  'Found automatically': '自動検出',
  'Add a language server': '言語サーバーを追加',
  'For a language not listed: its name, the languages or file extensions it serves (ruby, .zig), and the command that starts it over stdio.':
    '一覧にない言語用です。名前、対象の言語またはファイル拡張子（ruby, .zig）、標準入出力で起動するコマンドを指定します。',
  'Language server name': '言語サーバーの名前',
  'Languages or file extensions': '言語またはファイル拡張子',
  'Language server command': '言語サーバーのコマンド',
  'Completion, diagnostics and navigation come from language servers on the host where the files are. Zomfy starts the ones it finds there and installs none.':
    '補完・診断・定義への移動は、ファイルがあるホスト上の言語サーバーが担います。Zomfy はそこで見つかったものを起動するだけで、インストールはしません。',

  // Problems (components/problems/ProblemsPanel.tsx, the status bar's problems item)
  Problems: '問題',
  'No problems in the open files': '開いているファイルに問題はありません',
  '{errors} errors, {warnings} warnings in {files} open files': '開いているファイル {files} 件にエラー {errors} 件、警告 {warnings} 件',
  '{errors} errors, {warnings} warnings in the open files': '開いているファイルにエラー {errors} 件、警告 {warnings} 件'
}
