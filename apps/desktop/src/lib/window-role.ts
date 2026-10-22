/** Which window this webview is: the app, the agent dashboard or one workspace popped out into its own window. */
export type WindowRole = 'main' | 'dashboard' | 'workspace'

const params = new URLSearchParams(window.location.search)
const requested = params.get('window')

export const WINDOW_ROLE: WindowRole = requested === 'dashboard' || requested === 'workspace' ? requested : 'main'

/** The workspace a workspace window shows. */
export const WINDOW_WORKSPACE_ID: string | null = WINDOW_ROLE === 'workspace' ? params.get('workspace') : null
