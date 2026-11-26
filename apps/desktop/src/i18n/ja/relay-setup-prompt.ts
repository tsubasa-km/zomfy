import type { RelayPromptText } from '@/lib/relay-setup-prompt'

// The Japanese "Set up with an agent" prompt (docs/specs/relay-settings.md#the-prompt). The person
// picks its language in the dialog, so it is built from these pieces, not through t().
export const RELAY_PROMPT_JA: RelayPromptText = {
  intro: (features) =>
    `Zomfy リポジトリの \`apps/relay\` にある Cloudflare Worker「Zomfy Relay」を、私自身の Cloudflare アカウントにセットアップしてください。使う機能: ${features}。`,
  checkout: 'このフォルダーは Zomfy のチェックアウトです。',
  clone: (repo) => `このフォルダーは Zomfy（${repo}）を新しく clone したものです。`,
  existing: (url) => `Zomfy はすでに ${url} のリレーとペアリングしています。2 つ目の Worker は作らず、その Worker を更新してください。`,
  readFirst: 'まず `apps/relay/README.md` と `docs/specs/relay-settings.md` を読んでから、1 ステップずつ進めてください。',
  announce:
    '各ステップの前に、これから何をするかを伝えてください。私が操作する必要があるところ（サインイン、Discord・Slack・GitHub・Linear でのアプリ作成、コマンドの実行）では、私を待ってください。',
  deploy:
    '`apps/relay` で `npx wrangler whoami` がサインインしていないと言ったら、私が実行する `npx wrangler login` を示してください。そのあと `apps/relay` で `npx wrangler deploy` を実行してデプロイし、表示された Worker URL を控えてください。',
  mcp: 'このチャットでは Cloudflare の MCP サーバー（`cloudflare`）も使えます。アカウントの確認や Worker のチェックに使ってください。サインインが必要なら、チャットのコネクタからサインインするよう私に頼んでください。使うのはこの Worker のためだけにしてください。',
  secrets:
    'シークレットについて: シークレットの値を自分で作ったり推測したり生成したりしないでください。また、表示・echo・ログ出力・コミットや、リポジトリ内のファイルへの書き込みもしないでください。シークレットごとに、コマンドを個別の ```bash ブロックで示してください（例: `apps/relay` で `npx wrangler secret put DISCORD_BOT_TOKEN`）。私がそれを実行し、wrangler のプロンプトに自分で値を入力します。もし私がチャットにシークレットを貼り付けてしまった場合も、標準入力でだけ渡し、決して繰り返し表示しないでください。',
  setupCode:
    '`SETUP_CODE` は Zomfy とリレーをペアリングするためのコードです。私に `openssl rand -hex 16` で作ってもらい、`npx wrangler secret put SETUP_CODE` で設定し、ペアリング用に控えておくよう伝えてください。',
  featuresVar: (value) =>
    `\`FEATURES\` を \`${value}\` に設定してください。以後のデプロイでも残るよう \`npx wrangler secret put FEATURES\` を使います。これはシークレットではないので、値を標準入力で渡してあなたが実行してかまいません。`,
  perFeature: '機能ごとに:',
  feature: {
    phone: 'スマホアプリ: Cloudflare 側での追加設定はありません。',
    discord:
      'Discord: discord.com/developers で私が作るアプリケーションの `DISCORD_APPLICATION_ID`、`DISCORD_PUBLIC_KEY`、`DISCORD_BOT_TOKEN`。README の「Discord」の節に従ってください（Interactions Endpoint URL `<Worker URL>/discord/interactions`、Message Content Intent、サーバーへのアプリ追加）。',
    slack:
      'Slack: Worker URL を入れた `apps/relay/slack-manifest.yaml` から私が作るアプリの `SLACK_BOT_TOKEN` と `SLACK_SIGNING_SECRET`。README の「Slack」の節に従ってください。',
    github:
      'GitHub: `apps/relay` の `bun run deploy --github` が GitHub App を作り、`GITHUB_APP_ID`・`GITHUB_APP_PRIVATE_KEY`・`GITHUB_WEBHOOK_SECRET`・`GITHUB_APP_SLUG` を設定します。ブラウザーが開くので私が実行します。README の「GitHub」の節に従ってください。',
    linear:
      'Linear: `<Worker URL>/linear/webhook` への Webhook（Issues、Comments、Issue labels）の `LINEAR_WEBHOOK_SECRET` と、`LINEAR_ACCESS_TOKEN`（個人の API キー）または `LINEAR_CLIENT_ID` と `LINEAR_CLIENT_SECRET`（Client credentials を有効にした OAuth アプリ）のどちらか。README の「Linear」の節に従ってください。',
    webhooks: 'Webhook: Cloudflare 側での設定はありません。ボットの Webhook トリガーごとに Zomfy で URL が作られます。'
  },
  featureName: { phone: 'スマホアプリ', discord: 'Discord', slack: 'Slack', github: 'GitHub', linear: 'Linear', webhooks: 'Webhook' },
  health:
    '`<Worker URL>/health` を確認してください。`features` が選んだ機能とちょうど一致し、`missing` が空であるはずです。まだ足りないものがあれば、シークレット名で教えてください。',
  pair: '最後に、Zomfy の「設定 → Zomfy Relay」で Worker URL とセットアップコードを使ってペアリングするよう伝え、各ソースで私がまだすること（貼り付ける URL）を教えてください。',
  pairPhone: 'スマホは、そのあと「設定 → デバイス → スマートフォンをペアリング」です。',
  limits:
    'Cloudflare アカウントのそれ以外のものは変更せず、ほかの Worker を削除・改名しないでください。不明な点があれば止まって私に聞いてください。'
}
