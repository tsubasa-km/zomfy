import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Server } from 'lucide-react'
import { connectHost } from '@/daemon-connection'
import { useStore } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// VS Code Remote-SSH's "Connect to Host…": the aliases from ~/.ssh/config, or user@host[:port].
// The system ssh does the login, so keys, agent and ProxyJump from the user's config all apply.

interface SshConfigHost {
  alias: string
  hostname: string | null
  user: string | null
  port: number | null
}

/** Shape check only; the desktop side validates the destination before running ssh. */
export function sshTargetError(input: string): string | null {
  const target = input.trim().replace(/^ssh:\/\//, '').replace(/\/+$/, '')
  if (!target) return 'Enter an alias or user@host[:port]'
  if (target.startsWith('-') || /[\s"'`$;&|<>(),\\%^!]/.test(target)) return 'Not a valid SSH destination'
  return null
}

function useSshConfigHosts(): SshConfigHost[] | null {
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null)
  useEffect(() => {
    if (!isTauri()) {
      setHosts([])
      return
    }
    invoke<SshConfigHost[]>('ssh_config_hosts').then(setHosts, () => setHosts([]))
  }, [])
  return hosts
}

function describe(host: SshConfigHost): string {
  const target = [host.user ? `${host.user}@` : '', host.hostname ?? '', host.port && host.port !== 22 ? `:${host.port}` : '']
  return target.join('')
}

export function SshHostPicker({ onConnect }: { onConnect?: (hostId: string) => void }) {
  const configHosts = useSshConfigHosts()
  const hosts = useStore((s) => s.hosts)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  function connect(target: string) {
    const hostId = `ssh:${target.trim().replace(/^ssh:\/\//, '').replace(/\/+$/, '')}`
    void connectHost(hostId)
    onConnect?.(hostId)
  }

  return (
    <div className="space-y-3" data-ssh-host-picker>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">From ~/.ssh/config</p>
        {configHosts === null ? (
          <p className="text-xs text-muted-foreground">Reading ~/.ssh/config…</p>
        ) : configHosts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Host aliases found.</p>
        ) : (
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {configHosts.map((host) => {
              const hostId = `ssh:${host.alias}`
              const kind = hosts[hostId]?.connection.kind
              return (
                <button
                  key={host.alias}
                  type="button"
                  data-ssh-alias={host.alias}
                  disabled={kind === 'connected' || kind === 'connecting'}
                  onClick={() => connect(host.alias)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <Server className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{host.alias}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {kind === 'connected' ? 'Connected' : kind === 'connecting' ? 'Connecting…' : describe(host)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault()
          const problem = sshTargetError(typed)
          setError(problem)
          if (!problem) {
            connect(typed)
            setTyped('')
          }
        }}
      >
        <p className="text-xs font-medium text-muted-foreground">Other host</p>
        <div className="flex gap-2">
          <Input
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              setError(null)
            }}
            placeholder="user@host:22"
            aria-label="SSH destination"
            className="font-mono text-xs"
          />
          <Button type="submit" variant="outline" disabled={!typed.trim()}>
            Connect
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </form>
      <p className="text-xs text-muted-foreground">
        Uses your OpenSSH setup and never asks for passwords: <code className="font-mono">ssh &lt;host&gt;</code> must connect without a prompt (key auth or
        ssh-agent). Linux x64 and arm64 hosts are supported.
      </p>
    </div>
  )
}
