import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ModelTier } from '../types'

const PLUGIN = 'auto-model'
const STORE_KEY = 'isOn'
const TIERS: readonly ModelTier[] = ['simple', 'moderate', 'complex']
const MODEL_OF: Record<ModelTier, string> = {
  simple: 'haiku',
  moderate: 'sonnet',
  complex: 'opus',
}
// Prompts this short ("yes", "do it", "go on") keep the previous tier, so a
// follow-up inside a hard task does not drop to the smallest model.
const SHORT_WORDS = 6

const isOn = atom({ plugin: 'auto-model', key: 'isOn' } as const, true)
const isOpen = atom({ plugin: 'auto-model', key: 'isOpen' } as const, false)
const lastTier = atom({ plugin: 'auto-model', key: 'lastTier' } as const, null)

const CLASSIFY_HINT =
  'Rate how much reasoning this request to a coding assistant needs. ' +
  'simple: a quick question, lookup, rename, small edit or short explanation. ' +
  'moderate: an ordinary feature, bug fix or multi-step task in a few files. ' +
  'complex: architecture, hard debugging, large refactors, research, or deep analysis.\n\n' +
  'Request:\n'

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function heuristicTier(text: string): ModelTier {
  const words = wordCount(text)
  if (words > 120) {
    return 'complex'
  }
  if (words > 25) {
    return 'moderate'
  }
  return 'simple'
}

function asTier(label: string | undefined): ModelTier | undefined {
  return TIERS.find(tier => tier === label)
}

// The icon's palette: one hue per model, and a dark track for what a bar leaves empty
const MODEL_COLOR: Record<ModelTier, string> = {
  complex: '#D97757',
  moderate: '#6A9BCC',
  simple: '#788C5D',
}
const CELLS: Record<ModelTier, number> = { complex: 3, moderate: 2, simple: 1 }
const ROWS: readonly ModelTier[] = ['complex', 'moderate', 'simple']
const GREEN = '#788C5D'
const TRACK = '#4a4f5c'
const NARROW = 30

// Blend a #rrggbb color toward white (t > 0) or black (t < 0) by |t|
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const target = t >= 0 ? 255 : 0
  const ch = (v: number) =>
    Math.round(v + (target - v) * Math.abs(t))
      .toString(16)
      .padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

// Cells of a bar: filled ones run from a deep shade of the color to a light one
function barCells(tier: ModelTier): { text: string; color: string }[] {
  const filled = CELLS[tier]
  const cells: { text: string; color: string }[] = []
  for (let i = 0; i < 3; i++) {
    if (i < filled) {
      const shade = filled === 1 ? 0 : -0.15 + (0.35 * i) / (filled - 1)
      cells.push({ text: '■', color: lighten(MODEL_COLOR[tier], shade) })
    } else {
      cells.push({ text: '■', color: TRACK })
    }
  }
  return cells
}

export const register: Register = on => {
  // turnId -> model picked for that turn; every step of the turn uses it.
  const picks = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    if (typeof stored === 'boolean') {
      await update($, isOn, () => stored)
    }
    await $.command.register({
      name: 'auto-model',
      description: 'Turn auto model selection on or off (on | off | toggle)',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'auto-model' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, isOn)
    let wanted = !current
    if (arg === 'on') {
      wanted = true
    }
    if (arg === 'off') {
      wanted = false
    }
    await update($, isOn, () => wanted)
    await $.store.set(STORE_KEY, wanted)
    return { text: `Auto model is ${wanted ? 'on' : 'off'}.` }
  })

  on('turn.start', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const text = e.text.trim()
    if (!isMain || text === '' || !(await read($, isOn))) {
      return next(e)
    }
    const previous = await read($, lastTier)
    let tier: ModelTier
    if (previous !== null && wordCount(text) < SHORT_WORDS) {
      tier = previous
    } else {
      const label = await $.model
        .classify(CLASSIFY_HINT + text.slice(0, 4000), TIERS)
        .catch(() => undefined)
      tier = asTier(label) ?? heuristicTier(text)
    }
    picks.set(e.turnId, MODEL_OF[tier])
    await update($, lastTier, () => tier)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const model = e.agentId === undefined ? picks.get(e.turnId) : undefined
    if (model === undefined) {
      return yield* next(e)
    }
    return yield* next({ ...e, model })
  })

  on('turn.complete', ($, e, next) => {
    picks.delete(e.turnId)
    return next(e)
  })

  // The button: bottom-right of the footer, under the prompt.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const isEnabled = await read($, isOn)
    const tier = await read($, lastTier)
    const pick = tier === null ? 'auto' : MODEL_OF[tier]
    const color = isEnabled && tier !== null ? MODEL_COLOR[tier] : undefined

    return (
      <Box key="auto-model" flexDirection="row">
        {await next(e)}
        <Text dimColor> </Text>
        <Button
          key="auto-model-button"
          plain
          onPress={() => update($, isOpen, value => !value)}
        >
          {isEnabled ? (
            <Text color={color ?? GREEN}>{`◆ ${pick} ▾`}</Text>
          ) : (
            <Text dimColor>◇ auto off ▾</Text>
          )}
        </Button>
      </Box>
    )
  })

  // The dropdown panel: a row in the band just above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isPanelOpen = await read($, isOpen)
    if (!isPanelOpen || e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const isEnabled = await read($, isOn)
    const tier = await read($, lastTier)
    const isNarrow = e.props.bodyColumns < NARROW

    return (
      <Box flexDirection="column" alignItems="flex-end">
        <Box flexDirection="column" alignSelf="flex-end" paddingX={1}>
          <Box flexDirection="row" columnGap={2}>
            <Text bold>auto model</Text>
            <Button
              key="auto-model-switch"
              plain
              onPress={async () => {
                const wanted = !(await read($, isOn))
                await update($, isOn, () => wanted)
                await $.store.set(STORE_KEY, wanted)
              }}
            >
              {isEnabled ? (
                <Text color={GREEN} bold>
                  ● on
                </Text>
              ) : (
                <Text dimColor>○ off</Text>
              )}
            </Button>
            <Button
              key="auto-model-close"
              plain
              onPress={() => update($, isOpen, () => false)}
            >
              <Text dimColor>×</Text>
            </Button>
          </Box>
          {ROWS.map(row => {
            const isPicked = tier === row
            const isDim = !isEnabled || (tier !== null && !isPicked)
            return (
              <Box key={row} flexDirection="row">
                {!isNarrow &&
                  barCells(row).map((cell, n) => (
                    <Text
                      key={`c${n}`}
                      color={cell.color}
                      dimColor={!isEnabled && cell.color !== TRACK}
                    >
                      {cell.text}
                    </Text>
                  ))}
                {!isNarrow && <Text> </Text>}
                <Text
                  color={MODEL_COLOR[row]}
                  bold={isPicked && isEnabled}
                  dimColor={isDim}
                >
                  {MODEL_OF[row].padEnd(7)}
                </Text>
                {!isNarrow && <Text dimColor>{row}</Text>}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
