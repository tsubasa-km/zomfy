import { describe, expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { approvalOutcome } from '../src/components/native-chat/native-chat-transcript-model.ts'
import { EXPIRED_APPROVAL } from '../src/lib/expired-approval.ts'

const options: acp.PermissionOption[] = [
  { kind: 'allow_once', name: 'Allow', optionId: 'yes-please' },
  { kind: 'reject_once', name: 'Deny', optionId: 'no-thanks' }
]
const approval = (chosen: string) => ({ kind: 'permission' as const, requestId: 'r', title: 'Bash', options, chosen })

describe('approvalOutcome', () => {
  test('an ask nobody answered reads as expired, not rejected', () => {
    expect(approvalOutcome(approval(EXPIRED_APPROVAL))).toBe('expired')
  })
  test("the picked option's kind decides, whatever the agent named it", () => {
    expect(approvalOutcome(approval('no-thanks'))).toBe('rejected')
    expect(approvalOutcome(approval('yes-please'))).toBe('allowed')
  })
})
