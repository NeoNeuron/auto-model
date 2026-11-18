export type ModelTier = 'simple' | 'moderate' | 'complex'

declare module 'claude-code' {
  interface PluginState {
    'auto-model': { isOn: boolean; isOpen: boolean; lastTier: ModelTier | null; boost: boolean }
  }
}
