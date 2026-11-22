// The contract's version. Change beyond version 1 happens through the `features` lists both sides
// advertise in `hello` / `hello-ok`, as in Orca's connector contract.

export const CONTRACT_VERSION = 1

/** Prefix of every signed string, so a signature for the relay is never valid anywhere else. */
export const SIGNATURE_DOMAIN = 'zomfy-relay-v1'

/** Features this build of the contract knows. Each side sends the subset it implements. */
export const KNOWN_FEATURES = ['hello-bots-pages', 'events-seq', 'actions', 'triggers'] as const
export type Feature = (typeof KNOWN_FEATURES)[number]
