// Japanese for Zomfy Bots (docs/specs/bots/desktop.md), keyed by the English text as the code writes it.
export const BOTS: Record<string, string> = {
  // components/bots/AccessRequestRow.tsx
  '{name} on {source} asks to use {bot}': '{source} の {name} さんが {bot} の利用を申請しています',
  'a bot': 'ボット',
  Allow: '許可',
  Decline: '断る',

  // components/bots/BotAvatar.tsx
  'Waiting on you': 'あなたの対応待ち',

  // components/bots/BotChatHeader.tsx
  'from {chat}': '「{chat}」から',
  'a chat that is gone': '削除されたスレッド',
  'from {source}': '{source} から',
  'asked by {name}': '{name} さんの依頼',
  'A deleted bot': '削除されたボット',
  'A new chat with {name}': '{name} と新しいチャット',
  'The chat did not open': 'チャットを開けませんでした',
  'New chat': '新しいチャット',

  // components/bots/BotEditorDialog.tsx
  'Choose the bot’s home folder': 'ボットのホームフォルダーを選択',
  'Edit bot': 'ボットを編集',
  'Create bot': 'ボットを作成',
  'A bot is a named agent with a home folder on this computer. It remembers in MEMORY.md and is who SOUL.md says.':
    'ボットは、このコンピューターにホームフォルダーを持つ名前付きのエージェントです。覚えたことを MEMORY.md に書き、SOUL.md に書かれた人物として振る舞います。',
  Avatar: 'アバター',
  Handle: 'ハンドル',
  'Ask it with @{handle} in a chat, or after the bot’s mention in Discord.':
    'チャットで @{handle}、または Discord でボットへのメンションの後に書いて依頼します。',
  Purpose: '用途',
  'Optional. One line on what it is for; SOUL.md says the rest.': '任意。何のためのボットかを 1 行で。詳しくは SOUL.md に書きます。',
  'Empty: the agent’s default.': '空欄ならエージェントの既定',
  'Permission mode': '権限モード',
  'Others can ask a bot, so a new one asks for approval before each tool use.':
    'ボットには他の人も依頼できるため、新しいボットはツールを使うたびに承認を求めます。',
  'A new folder, ~/zomfy/bots/{handle}': '新しいフォルダー（~/zomfy/bots/{handle}）',
  'An existing folder or repository': '既存のフォルダーまたはリポジトリ',
  'Folder path': 'フォルダーのパス',
  'Default bot': '既定のボット',
  'Takes messages in Discord and other sources that name no bot.': 'Discord などでボット名を指定しないメッセージを受け持ちます。',

  // components/bots/BotsPage.tsx
  '{n} min ago': '{n} 分前',
  '{n} h ago': '{n} 時間前',
  'Paused: it takes no new requests.': '一時停止中：新しい依頼は受け付けません。',
  'No purpose given; SOUL.md says who it is.': '用途は未設定です。人物像は SOUL.md にあります。',
  'Bot settings': 'ボットの設定',
  'Close bots': 'ボットを閉じる',
  'Named agents with a home folder, asked from Zomfy, Discord and more':
    'ホームフォルダーを持つ名前付きエージェント。Zomfy や Discord などから依頼できます',
  'This computer’s daemon has no bots yet; update Zomfy to use them.':
    'このコンピューターのデーモンはまだボットに対応していません。Zomfy を更新してください。',
  'No bots yet. A bot lives in a folder with its SOUL.md and MEMORY.md, and you can talk to it here with no cloud set up.':
    'ボットはまだありません。ボットは SOUL.md と MEMORY.md のあるフォルダーに住み、クラウドを設定しなくてもここで話せます。',
  '{name} is ready. Click it to talk to it.': '{name} の準備ができました。クリックすると話せます。',

  // components/settings/BotsPane.tsx
  'In Discord, turn on Developer Mode (Settings → Advanced), then right-click your name and choose Copy User ID.':
    'Discord で開発者モード（設定 → 詳細設定）をオンにし、自分の名前を右クリックして「ユーザー ID をコピー」を選びます。',
  'In Slack, open your profile, choose ⋮ and Copy member ID.': 'Slack で自分のプロフィールを開き、⋮ から「メンバー ID をコピー」を選びます。',
  'Your GitHub login, as in github.com/<login>.': 'GitHub のログイン名（github.com/<login> の部分）です。',
  'In Linear, open your profile; the id is in the URL after /profiles/.': 'Linear で自分のプロフィールを開くと、URL の /profiles/ の後が ID です。',
  'Offline, retrying': 'オフライン（再接続中）',
  'Refused: pair again': '拒否されました。もう一度ペアリングしてください',
  'Not paired': '未ペアリング',
  Relay: 'リレー',
  'Your own Zomfy Relay on Cloudflare carries Discord and other sources to this computer. The same relay serves the phone. Bots answer in Zomfy without one.':
    'あなたの Cloudflare 上の Zomfy Relay が、Discord などからの依頼をこのコンピューターに届けます。スマホも同じリレーを使います。リレーがなくても、ボットは Zomfy の中で答えます。',
  'Worker URL': 'Worker の URL',
  'Host id': 'ホスト ID',
  'Last hello': '最後の接続',
  'Not yet': 'まだありません',
  'Next try': '次の再接続',
  Unpair: 'ペアリング解除',
  'Worker URL, https://zomfy-relay.<you>.workers.dev': 'Worker の URL（https://zomfy-relay.<you>.workers.dev）',
  'Setup code': 'セットアップコード',
  Pair: 'ペアリング',
  'Deploy to Cloudflare': 'Cloudflare にデプロイ',
  'or run': 'または',
  'in apps/relay;': 'を apps/relay で実行。',
  'the guide': '手順',
  'Interactions endpoint URL': 'Interactions Endpoint URL',
  Webhooks: 'Webhook',
  Sources: 'ソース',
  'Where bots can be asked. A source is on when the relay has its secrets.':
    'ボットに依頼できる場所です。リレーにそのソースのシークレットがあると有効になります。',
  Configured: '設定済み',
  'Not configured': '未設定',
  'No relay': 'リレーなし',
  'Setup steps': '設定手順',
  'Your id (the owner)': 'あなたの ID（オーナー）',
  'Your {source} id': 'あなたの {source} の ID',
  Owner: 'オーナー',
  Member: 'メンバー',
  'Their id': '相手の ID',
  'Name (optional)': '名前（任意）',
  'All bots': 'すべてのボット',
  'Its home folder is not a project on this computer any more.': 'ホームフォルダーはもうこのコンピューターのプロジェクトではありません。',
  'Open SOUL.md': 'SOUL.md を開く',
  'Open MEMORY.md': 'MEMORY.md を開く',
  'Open home folder': 'ホームフォルダーを開く',
  'Who can ask': '依頼できる人',
  'Only you and the people listed here can start or steer this bot from a source. Others are told to ask you, and may send an access request.':
    'ソースからこのボットに依頼・指示できるのは、あなたとここに載っている人だけです。それ以外の人にはあなたに頼むよう案内され、利用申請を送れます。',
  'Access requests': '利用申請',
  'Schedules and triggers': 'スケジュールとトリガー',
  'A bot’s schedules and event triggers come in a later Zomfy version; until then use Automations in its home folder.':
    'ボットのスケジュールとイベントトリガーは今後のバージョンで対応します。それまではホームフォルダーで Automations を使ってください。',
  'A paused bot takes no new requests; turns already running go on.': '一時停止中のボットは新しい依頼を受け付けません。実行中のターンは続きます。',
  'Delete {name}? Its chats stay.': '{name} を削除しますか？チャットは残ります。',
  'Also delete the folder (only a folder Zomfy made under ~/zomfy/bots)': 'フォルダーも削除する（~/zomfy/bots に Zomfy が作ったフォルダーのみ）',
  'Delete bot': 'ボットを削除',
  'Each bot lives in a home folder on this computer and runs on its agent’s sign-in here.':
    'ボットはこのコンピューターのホームフォルダーに住み、ここでのエージェントのサインインで動きます。',
  'No bots yet.': 'ボットはまだありません。',
  '{n} access requests': '利用申請 {n} 件',

  // components/settings/settings-navigation.ts (Bots)
  'Your relay, the sources it carries, and each bot: its files, who can ask, pause and delete.':
    'リレーとそれが運ぶソース、そして各ボットのファイル・依頼できる人・一時停止・削除。',
  // components/automations/AutomationsPage.tsx (bot triggers)
  Webhook: 'Webhook',
  'any event': 'すべてのイベント',
  'On {source}: {kinds}': '{source}：{kinds}'
}
