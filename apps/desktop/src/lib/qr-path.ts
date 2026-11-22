import qrcode from 'qrcode-generator'

/** A QR code as one SVG path of unit squares (no HTML strings), and its size in modules. */
export function qrPath(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'L')
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
  }
  return { size, path }
}
