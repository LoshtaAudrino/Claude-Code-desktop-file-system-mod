declare module 'claude-code' {
  interface PluginState {
    commander: {
      root: Shaped<string>
      open: Shaped<string>
      sel: Shaped<string>
    }
  }
}
