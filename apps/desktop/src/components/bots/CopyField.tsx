import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n/i18n'

/** A value to paste elsewhere (a URL, a key), with a Copy button. */
export function CopyField({ value, data }: { value: string; data?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs select-all" data-copy-field={data}>
        {value}
      </code>
      <Button variant="outline" size="xs" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}>
        {copied ? <Check /> : <Copy />}
        {copied ? t('Copied') : t('Copy')}
      </Button>
    </div>
  )
}
