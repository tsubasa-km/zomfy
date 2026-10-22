import { describe, expect, test } from 'bun:test'
import {
  commandShellFamily,
  commandTerminalInput,
  commandTerminalTitle,
  pickCommandShell,
  runnableCommandLines
} from '../src/components/native-chat/native-chat-command-run.ts'

const WINDOWS_SHELLS = [
  { id: 'pwsh', label: 'PowerShell 7' },
  { id: 'powershell', label: 'Windows PowerShell' },
  { id: 'cmd', label: 'Command Prompt' },
  { id: 'git-bash', label: 'Git Bash' }
]
const LINUX_SHELLS = [{ id: 'login', label: 'bash' }]

describe('commandShellFamily', () => {
  test('only terminal languages run', () => {
    expect(commandShellFamily('bash')).toBe('posix')
    expect(commandShellFamily('Shell-Session')).toBe('posix')
    expect(commandShellFamily('ps1')).toBe('powershell')
    expect(commandShellFamily('bat')).toBe('cmd')
    expect(commandShellFamily('ts')).toBeNull()
    expect(commandShellFamily(undefined)).toBeNull()
  })
})

describe('runnableCommandLines', () => {
  test('plain script keeps every line, without fence padding', () => {
    expect(runnableCommandLines('\nnpm install\nnpm test\n', 'bash')).toEqual(['npm install', 'npm test'])
  })
  test('console transcripts drop prompts and output', () => {
    const code = '$ ls -la\ntotal 0\n$ docker run \\\n    -it ubuntu\n> echo continued\noutput\n'
    expect(runnableCommandLines(code, 'console')).toEqual(['ls -la', 'docker run \\', '    -it ubuntu', 'echo continued'])
  })
  test('a bash block written with $ prompts is read as a transcript', () => {
    expect(runnableCommandLines('$ npm ci\nadded 10 packages\n', 'bash')).toEqual(['npm ci'])
  })
  test('PowerShell prompts', () => {
    expect(runnableCommandLines('PS C:\\repo> Get-ChildItem\n\n    Directory: C:\\repo\n', 'powershell')).toEqual(['Get-ChildItem'])
  })
  test('a transcript with no commands is not runnable', () => {
    expect(runnableCommandLines('just output\n', 'console')).toEqual([])
  })
})

describe('pickCommandShell', () => {
  test('Windows hosts', () => {
    expect(pickCommandShell('posix', WINDOWS_SHELLS)?.id).toBe('git-bash')
    expect(pickCommandShell('powershell', WINDOWS_SHELLS)?.id).toBe('pwsh')
    expect(pickCommandShell('cmd', WINDOWS_SHELLS)?.id).toBe('cmd')
    expect(pickCommandShell('posix', WINDOWS_SHELLS.slice(0, 3))).toBeNull()
  })
  test('POSIX hosts (WSL, SSH)', () => {
    expect(pickCommandShell('posix', LINUX_SHELLS)?.id).toBe('login')
    expect(pickCommandShell('powershell', LINUX_SHELLS)).toBeNull()
    expect(pickCommandShell('cmd', LINUX_SHELLS)).toBeNull()
  })
})

describe('commandTerminalInput', () => {
  test('one line runs as typed', () => {
    expect(commandTerminalInput(['npm test'], 'posix')).toBe('npm test\r')
  })
  test('several lines are parsed as one group before any runs', () => {
    expect(commandTerminalInput(['cd app', 'npm test'], 'posix')).toBe('{\rcd app\rnpm test\r}\r')
    expect(commandTerminalInput(['$x = 1', 'echo $x'], 'powershell')).toBe('. {\r$x = 1\recho $x\r}\r')
    expect(commandTerminalInput(['cd app', '', 'dir'], 'cmd')).toBe('cd app\rdir\r')
  })
  test('titles name the first command', () => {
    expect(commandTerminalTitle(['# setup', 'npm ci', 'npm test'])).toBe('npm ci …')
    expect(commandTerminalTitle(['x'.repeat(60)])).toHaveLength(40)
  })
})
