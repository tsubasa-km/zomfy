// UI strings: the English text is the key, `ja` translates it. The React Native layer picks the
// language from expo-localization; this module has no React Native imports.

export type Language = 'en' | 'ja'

const ja: Record<string, string> = {
  Hosts: 'ホスト',
  'Needs you': '要対応',
  Settings: '設定',
  'Pair a host': 'ホストとペアリング',
  Pair: 'ペアリング',
  'No hosts yet': 'まだホストがありません',
  'Open Zomfy on your computer, go to Settings → Devices → Pair a phone, and scan the QR code.':
    'パソコンの Zomfy で 設定 → デバイス → スマートフォンをペアリング を開き、QR コードを読み取ってください。',
  'Scan QR code': 'QR コードを読み取る',
  'Paste link': 'リンクを貼り付け',
  'Pairing link': 'ペアリングリンク',
  'Phone name': 'スマートフォンの名前',
  'Pair this phone': 'このスマートフォンをペアリング',
  'Pairing…': 'ペアリング中…',
  'Paired with {host}': '{host} とペアリングしました',
  'Camera access is needed to scan the code.': 'コードを読み取るにはカメラへのアクセスが必要です。',
  'Allow camera': 'カメラを許可',
  'Point the camera at the QR code in Zomfy.': 'Zomfy に表示された QR コードにカメラを向けてください。',
  'Not a Zomfy pairing link': 'Zomfy のペアリングリンクではありません',
  'This pairing link has expired': 'このペアリングリンクは期限切れです',
  'This pairing link has no route to the host': 'このペアリングリンクにはホストへの経路がありません',
  'No route to the host answers': 'ホストへの経路が応答しません',
  'A different host answered on this route': 'この経路では別のホストが応答しました',
  'This phone was unpaired; pair again': 'このスマートフォンのペアリングは解除されました。もう一度ペアリングしてください',
  'This phone was unpaired on the host; pair again':
    'ホスト側でペアリングが解除されました。もう一度ペアリングしてください',
  'Host {host}': 'ホスト {host}',
  'Expires in {minutes} min': 'あと {minutes} 分で期限切れ',
  Cancel: 'キャンセル',
  Connected: '接続中',
  'Connecting…': '接続しています…',
  Offline: 'オフライン',
  Unpaired: 'ペアリング解除',
  Stopped: '停止',
  'Wi-Fi': 'Wi-Fi',
  Tailnet: 'Tailnet',
  Relay: 'リレー',
  'Retry now': '今すぐ再試行',
  'Retrying in {seconds}s': '{seconds} 秒後に再試行',
  '{count} need you': '{count} 件の要対応',
  'Nothing needs you': '対応待ちはありません',
  Projects: 'プロジェクト',
  'No chats': 'チャットはありません',
  Other: 'その他',
  Idle: '待機中',
  Working: '作業中',
  Error: 'エラー',
  'Loading…': '読み込み中…',
  'Not connected to this host': 'このホストに接続していません',
  'Message': 'メッセージ',
  Send: '送信',
  Stop: '停止',
  'Show more': 'もっと見る',
  'Show less': '閉じる',
  Plan: '計画',
  Thinking: '思考',
  'Approval needed': '承認が必要です',
  'The agent asks': 'エージェントからの質問',
  'Your answer': '回答',
  'Or type your own answer': '自分で回答を入力',
  Answer: '回答する',
  Skip: 'スキップ',
  'Answered elsewhere': '別の場所で回答されました',
  'Open chat': 'チャットを開く',
  'Scopes granted': '許可されたスコープ',
  Routes: '経路',
  'Paired on {date}': '{date} にペアリング',
  'Device id': 'デバイス ID',
  Unpair: 'ペアリング解除',
  'Unpair {host}?': '{host} とのペアリングを解除しますか？',
  'This phone forgets its keys for this host. Revoke it in Zomfy too, under Settings → Devices.':
    'このスマートフォンはこのホスト用の鍵を削除します。Zomfy の 設定 → デバイス からも取り消してください。',
  'App version': 'アプリのバージョン',
  Language: '言語',
  'Pair again': 'もう一度ペアリング',
  'The host did not send this message': 'ホストはこのメッセージを送信しませんでした',
  'Nothing to send': '送信する内容がありません',
  'Already paired with {host}; the pairing was replaced.': '{host} とは既にペアリング済みでした。新しいペアリングに置き換えました。',
  'chats:read': 'チャットの閲覧',
  'chats:operate': 'チャットの操作',
  'terminals:operate': 'ターミナルの操作',
  'workspaces:operate': 'ワークスペースの操作',
  'bots:read': 'ボットの閲覧',
  'Untitled chat': '無題のチャット',
  'Waiting for the host': 'ホストを待っています',
  'Chat not found': 'チャットが見つかりません',
  Queue: 'キューに入れる',
  Queued: '送信待ち',
  'Remove queued message': '送信待ちのメッセージを取り消す',
  'The host is offline': 'ホストはオフラインです',
  'The relay did not answer in time': 'リレーが時間内に応答しませんでした',
  'The relay does not know this phone; pair again': 'リレーはこのスマートフォンを知りません。もう一度ペアリングしてください',
  'The encrypted channel broke; reconnecting': '暗号化された通信路が切れました。再接続しています',
  'Another connection of this phone replaced this one': 'このスマートフォンの別の接続に置き換えられました',
  'The host did not prove the key it paired with': 'ホストがペアリング時の鍵を証明しませんでした',
  'The host did not answer through the relay in time': 'ホストがリレー経由で時間内に応答しませんでした',
  'The host did not prove the key in the pairing code': 'ホストがペアリングコードの鍵を証明しませんでした',
  'The relay refused this pairing': 'リレーがこのペアリングを拒否しました',
  'The host reconnected': 'ホストが再接続しました',
  Bots: 'ボット',
  Talk: '話しかける',
  Paused: '一時停止中',
  Default: '既定',
  'Message to {name}': '{name} へのメッセージ',
  'Start chat': 'チャットを開始',
  'No bots on this host': 'このホストにはボットがありません',
  'Recent chats': '最近のチャット',
  'No chats with this bot yet': 'このボットとのチャットはまだありません',
  'Connect to the host to start a chat': 'チャットを始めるにはホストに接続してください',
  'This phone may not start chats on this host': 'このスマートフォンにはこのホストでチャットを始める権限がありません',
  '{count} bots': '{count} 個のボット',
  // turn-phase.ts (docs/specs/turn-taking-states.md), in the desktop's words
  'Needs your answer': '回答待ち',
  'Your turn': 'あなたの番です',
  'Background work running': 'バックグラウンドで作業中',
  'Wakes {time}': '{time} に再開'
}

const TABLES: Record<Language, Record<string, string>> = { en: {}, ja }

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export function languageFor(localeTag: string | null | undefined): Language {
  return localeTag?.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function createTranslator(language: Language): Translate {
  const table = TABLES[language]
  return (key, vars) => {
    const text = table[key] ?? key
    return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text
  }
}

/** Every key the Japanese table translates, for tests. */
export const japaneseKeys = (): string[] => Object.keys(ja)
