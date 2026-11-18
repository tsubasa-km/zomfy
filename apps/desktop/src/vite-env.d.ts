/// <reference types="vite/client" />

declare module 'virtual:file-icon-rules' {
  const rules: import('./lib/file-icons/icon-rules').FileIconRules
  export default rules
}
