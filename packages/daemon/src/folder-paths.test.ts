import { expect, test } from 'bun:test'
import { folderAfterMove, folderBelow, folderUnder, owningWorkspace, sameFolder } from './folder-paths.ts'

// Windows paths compare by their own form on any host, so these run everywhere.

test('one Windows folder however it is written down', () => {
  for (const other of ['c:\\work\\app', 'C:/Work/App', 'C:\\Work\\App\\', '\\\\?\\C:\\Work\\App', 'C:\\Work\\.\\App']) {
    expect(sameFolder('C:\\Work\\App', other)).toBe(true)
  }
  expect(sameFolder('\\\\?\\UNC\\server\\share\\x', '\\\\server\\share\\x')).toBe(true)
  expect(sameFolder('C:\\Work\\App', 'C:\\Work\\App2')).toBe(false)
  expect(sameFolder('C:\\Work\\my-repo', 'C:\\Work\\my.repo')).toBe(false)
})

test('POSIX folders compare as written, case included', () => {
  expect(sameFolder('/home/me/app/', '/home/me/app')).toBe(true)
  expect(sameFolder('/home/me/App', '/home/me/app')).toBe(false)
})

test('what lies below a folder keeps its own spelling', () => {
  expect(folderBelow('C:\\Work\\App\\packages\\Ui', 'c:/work/app')).toBe('packages/Ui')
  expect(folderBelow('c:/work/app/', 'C:\\Work\\App')).toBe('')
  expect(folderBelow('\\\\?\\C:\\Work\\App\\src', 'C:\\Work\\App')).toBe('src')
  // A sibling whose name starts the same is not below it.
  expect(folderBelow('C:\\Work\\App-feature', 'C:\\Work\\App')).toBeNull()
  expect(folderBelow('C:\\Other', 'C:\\Work\\App')).toBeNull()
  expect(folderBelow('/home/me/app/src/x', '/home/me/app')).toBe('src/x')
  expect(folderBelow('/home/me/apple', '/home/me/app')).toBeNull()
  expect(folderBelow('C:\\Work', 'C:\\')).toBe('Work')
})

test('a folder below a root in the root’s own separators', () => {
  expect(folderUnder('C:\\Work\\App', 'packages/Ui')).toBe('C:\\Work\\App\\packages\\Ui')
  expect(folderUnder('C:\\Work\\App\\', '')).toBe('C:\\Work\\App\\')
  expect(folderUnder('/home/me/app/', 'src/x')).toBe('/home/me/app/src/x')
})

test('the owner of a folder: its own workspace, else the deepest that holds it', () => {
  const workspaces = [
    { id: 'main', path: 'C:\\Work\\App' },
    { id: 'nested', path: 'C:\\Work\\App\\.worktrees\\feature' },
    { id: 'sibling', path: 'C:\\Work\\App-feature' }
  ]
  expect(owningWorkspace('c:/work/app', workspaces)?.id).toBe('main')
  expect(owningWorkspace('C:\\Work\\App\\src', workspaces)?.id).toBe('main')
  expect(owningWorkspace('C:\\Work\\App\\.worktrees\\feature\\src', workspaces)?.id).toBe('nested')
  expect(owningWorkspace('C:\\Work\\App-feature\\docs', workspaces)?.id).toBe('sibling')
  expect(owningWorkspace('D:\\Elsewhere', workspaces)).toBeNull()
})

test('a chat in a subfolder follows its project to the same subfolder', () => {
  expect(folderAfterMove('C:\\Old\\App\\packages\\ui', 'C:\\Old\\App', 'D:\\New\\App')).toBe('D:\\New\\App\\packages\\ui')
  expect(folderAfterMove('c:/old/app', 'C:\\Old\\App', 'D:\\New\\App')).toBe('D:\\New\\App')
  // A folder outside the project (an import placed at the root) goes to the new root.
  expect(folderAfterMove('C:\\Elsewhere', 'C:\\Old\\App', 'D:\\New\\App')).toBe('D:\\New\\App')
})
