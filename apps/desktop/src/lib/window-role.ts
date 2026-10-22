/** Which window this webview is: the app, or the agent dashboard popped out into its own window. */
export type WindowRole = 'main' | 'dashboard'

export const WINDOW_ROLE: WindowRole =
  new URLSearchParams(window.location.search).get('window') === 'dashboard' ? 'dashboard' : 'main'
