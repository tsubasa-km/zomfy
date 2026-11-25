// Bun embeds these as strings (`with { type: 'text' }`), in `bun build --compile` too.
declare module '*.md' {
  const text: string
  export default text
}
