// Settings → Devices: pairing an Android phone (docs/specs/mobile/pairing.md).
export const DEVICES: Record<string, string> = {
  Devices: 'デバイス',
  'Pair an Android phone with this computer, and revoke phones you no longer use.':
    'Android スマートフォンをこのコンピューターとペアリングし、使わなくなったスマートフォンを取り消します。',
  'Let phones connect': 'スマートフォンからの接続を許可',
  'Listening on port {port} for phones on this network or tailnet. Other addresses are refused.':
    'このネットワークまたは tailnet 上のスマートフォンをポート {port} で待ち受けています。それ以外のアドレスからの接続は拒否します。',
  'Opens port {port} to private and tailnet addresses only, so a paired phone can reach this computer.':
    'ペアリングしたスマートフォンがこのコンピューターに届くよう、プライベートアドレスと tailnet のアドレスにだけポート {port} を開きます。',
  'Could not listen: {reason}': '待ち受けを開始できませんでした: {reason}',
  'Pair a phone': 'スマートフォンをペアリング',
  'Shows a QR code for the Zomfy app on your Android phone.': 'Android スマートフォンの Zomfy アプリで読み取る QR コードを表示します。',
  'Turn on “Let phones connect” first.': '先に「スマートフォンからの接続を許可」をオンにしてください。',
  'New code': '新しいコード',
  'Pairing QR code': 'ペアリング用 QR コード',
  'Scan this with the Zomfy app': 'Zomfy アプリでこのコードを読み取ってください',
  'Works once, for {n} more minutes. The phone must be on the same network or tailnet.':
    '1 回だけ、あと {n} 分間使えます。スマートフォンは同じネットワークか tailnet に接続している必要があります。',
  'This code expired. Make a new one.': 'このコードは期限切れです。新しいコードを作ってください。',
  'Or paste this link in the app:': 'またはこのリンクをアプリに貼り付けてください:',
  Copied: 'コピーしました',
  'Reachable at:': '接続先:',
  Tailnet: 'Tailnet',
  'Wi-Fi / LAN': 'Wi-Fi / LAN',
  'Paired phones': 'ペアリング済みのスマートフォン',
  'A phone stays paired until you revoke it. Revoking closes its connection at once.':
    'スマートフォンは取り消すまでペアリングされたままです。取り消すとその接続はすぐに切れます。',
  'No phones yet.': 'まだスマートフォンはありません。',
  'Connected now': '接続中',
  'Last seen {time}': '最終接続 {time}',
  'Not connected yet': 'まだ接続していません',
  'Paired {date}': '{date} にペアリング',
  Revoke: '取り消す',
  'Read chats': 'チャットの閲覧',
  'Prompt, stop and approve': '送信・停止・承認',
  Terminals: 'ターミナル',
  Workspaces: 'ワークスペース',
  Bots: 'ボット'
}
