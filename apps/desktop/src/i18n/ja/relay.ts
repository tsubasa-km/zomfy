// Japanese for Settings → Zomfy Relay (docs/specs/relay-settings.md), keyed by the English text as the code writes it.
export const RELAY: Record<string, string> = {
  // components/settings/RelayPane.tsx
  'Relay version': 'リレーのバージョン',
  Serves: '提供中',
  'Not read yet': 'まだ読み込んでいません',
  'Chosen by': '決め方',
  'its FEATURES variable': 'FEATURES 変数',
  'which secrets are set': '設定済みのシークレット',
  'Zomfy Relay {version} serves': 'Zomfy Relay {version} の提供機能',
  'It serves': '提供機能',
  On: 'オン',
  'Needs secrets': 'シークレットが不足',
  'Off on the relay': 'リレーではオフ',
  'Check the relay': 'リレーを確認してください',
  Features: '機能',
  'Set up': 'セットアップ',
  'Set up with an agent': 'エージェントとセットアップ',
  Guide: 'ガイド',

  // components/settings/RelaySetupDialog.tsx
  'Set up Zomfy Relay with an agent': 'エージェントと Zomfy Relay をセットアップ',
  'None ticked': 'チェックなし',
  'Clone Zomfy into a new folder': '新しいフォルダーに Zomfy を clone',
  'Give this chat Cloudflare’s MCP server': 'このチャットに Cloudflare の MCP サーバーを追加',
  'The server of Cloudflare’s own agent plugin (cloudflare@claude-plugins-official), at {url}, which covers the whole Cloudflare API. It is added to this chat only; sign in to Cloudflare from the chat’s Connectors when it asks. Without it the agent uses wrangler.':
    'Cloudflare 公式のエージェントプラグイン（cloudflare@claude-plugins-official）のサーバー（{url}）で、Cloudflare API 全体を扱えます。このチャットにだけ追加されます。求められたらチャットのコネクタから Cloudflare にサインインしてください。追加しない場合、エージェントは wrangler を使います。',
  'Prompt language': 'プロンプトの言語',
  'Reset prompt': 'プロンプトを元に戻す',
  'Start chat': 'チャットを開始',

  // lib/relay-features.ts
  'Phone app': 'スマホアプリ',
  'Nothing to set in Cloudflare. Pair this computer with the relay here, then pair a phone in Settings → Devices.':
    'Cloudflare 側の設定は不要です。ここでこのコンピューターをリレーとペアリングし、設定 → デバイスでスマホをペアリングします。',
  'General Information → Application ID': 'General Information → Application ID',
  'General Information → Public Key': 'General Information → Public Key',
  'Bot → Reset Token; turn on Message Content Intent there too': 'Bot → Reset Token。同じページで Message Content Intent もオンにします',
  'Make an application at discord.com/developers, set its Interactions Endpoint URL, and add it to your server.':
    'discord.com/developers でアプリケーションを作り、Interactions Endpoint URL を設定して、サーバーに追加します。',
  'OAuth & Permissions → Bot User OAuth Token (xoxb-…)': 'OAuth & Permissions → Bot User OAuth Token（xoxb-…）',
  'Basic Information → App Credentials → Signing Secret': 'Basic Information → App Credentials → Signing Secret',
  'Make a Slack app from apps/relay/slack-manifest.yaml with your Worker URL in it, and install it to your workspace.':
    'Worker URL を入れた apps/relay/slack-manifest.yaml から Slack アプリを作り、ワークスペースにインストールします。',
  'The GitHub App’s App ID': 'GitHub App の App ID',
  'The app’s private key, the whole .pem': 'アプリの秘密鍵（.pem 全体）',
  'The app’s webhook secret': 'アプリの Webhook シークレット',
  'The app’s slug, as in github.com/apps/<slug>': 'アプリの slug（github.com/apps/<slug> の部分）',
  'bun run deploy --github in apps/relay makes the GitHub App and sets all four; then install the app on your repositories.':
    'apps/relay の bun run deploy --github が GitHub App を作り 4 つすべてを設定します。そのあとリポジトリにアプリをインストールします。',
  'The signing secret of the webhook to the URL below': '下の URL への Webhook の署名シークレット',
  'A personal API key (lin_api_…), or instead LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET of an OAuth app':
    '個人の API キー（lin_api_…）、または代わりに OAuth アプリの LINEAR_CLIENT_ID と LINEAR_CLIENT_SECRET',
  'Make a webhook in Linear for Issues, Comments and Issue labels, and a personal API key or an OAuth app with Client credentials.':
    'Linear で Issues・Comments・Issue labels の Webhook を作り、個人の API キーか Client credentials を有効にした OAuth アプリを用意します。',
  'Nothing to set in Cloudflare: each webhook trigger on a bot gets a URL of its own.':
    'Cloudflare 側の設定は不要です。ボットの Webhook トリガーごとに専用の URL が作られます。',
  'Enter the Worker URL, https://…': 'Worker の URL（https://…）を入力してください',
  'The relay answered {status}.': 'リレーが {status} を返しました。',
  'That URL is not a Zomfy Relay.': 'その URL は Zomfy Relay ではありません。',

  // components/settings/BotsPane.tsx
  'Bots answer in Zomfy without it; Discord, Slack, GitHub, Linear and webhooks reach them through it.':
    'リレーがなくてもボットは Zomfy 内で応答します。Discord・Slack・GitHub・Linear・Webhook はリレー経由で届きます。',
  'Sources: {sources}': 'ソース: {sources}',
  'No sources configured on the relay yet.': 'リレーにはまだソースが設定されていません。',
  'Relay settings': 'リレーの設定',

  // components/settings/settings-navigation.ts
  'Your own Cloudflare Worker for the phone app and the bots’ sources: pairing, the features you use, and what each needs.':
    'スマホアプリとボットのソースのための、あなた自身の Cloudflare Worker: ペアリング、使う機能、それぞれに必要なもの。',
  'Each bot: its files, who can ask, pause and delete. The relay that carries their sources is in Zomfy Relay.':
    '各ボットのファイル、依頼できる人、一時停止と削除。ソースを運ぶリレーは Zomfy Relay にあります。',

  // components/settings/DevicesPane.tsx
  'Turn on “Let phones connect”, or pair Zomfy Relay in Settings → Zomfy Relay, first.':
    '先に「スマートフォンからの接続を許可」をオンにするか、設定 → Zomfy Relay でペアリングしてください。',
  'Away from home, phones reach this computer through Zomfy Relay.': '外出先では、スマホは Zomfy Relay を通じてこのコンピューターにつながります。',
  'Zomfy Relay settings': 'Zomfy Relay の設定'
}
