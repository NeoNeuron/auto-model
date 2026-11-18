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
// Set after a "retry" that raised effort instead of switching model.
const boost = atom({ plugin: 'auto-model', key: 'boost' } as const, false)

// The classifier's answers: the three tiers, plus "retry" for a prompt saying the
// last answer fell short.
type Label = ModelTier | 'retry'
const LABELS: readonly Label[] = [...TIERS, 'retry']

// The criteria follow Anthropic's model-selection guide
// (academy.claude.com/tutorials/choosing-the-right-claude-model): a more capable
// model for ambiguity, long work where an early mistake carries through, high
// stakes and hard-to-verify output; a smaller one for specific, bounded tasks.
const CLASSIFY_HINT =
  'Rate which model this request to a coding assistant needs.\n' +
  'complex: ambiguous or underspecified; long or multi-step work where an early ' +
  'mistake carries through; high stakes; output that is hard to verify or has no ' +
  'single correct answer; architecture, hard debugging, large refactors, research, ' +
  'deep analysis.\n' +
  'moderate: an ordinary, well-specified feature, bug fix or multi-step task in a ' +
  'few files, with a clear way to check the result.\n' +
  'simple: a specific, bounded request with an obvious correct result: a quick ' +
  'question, lookup, rename, small edit or short explanation.\n' +
  'retry: the user says the previous answer missed (wrong, still failing, did not ' +
  'follow instructions, incomplete) or asks to try again.\n' +
  'If unsure between two levels, choose the higher one.\n\n' +
  'Request:\n'

// Effort levels in order; a boosted turn sends the one above the engine's.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function asLabel(label: string | undefined): Label | undefined {
  return LABELS.find(known => known === label)
}

function tierAbove(tier: ModelTier): ModelTier {
  const i = TIERS.indexOf(tier)
  return TIERS[i + 1] ?? tier
}

function effortAbove(effort: unknown): Effort | undefined {
  const i = EFFORTS.indexOf(effort as Effort)
  if (i < 0) {
    return undefined
  }
  return EFFORTS[Math.min(i + 1, EFFORTS.length - 1)]
}

// One rung up the guide's ladder: raise effort on the same model first, then move
// to the next model. Haiku has no effort rung, so it goes straight to sonnet.
function escalate(
  previous: ModelTier | null,
  isBoosted: boolean,
): { tier: ModelTier; isBoosted: boolean } {
  if (previous === null) {
    return { tier: 'complex', isBoosted: false }
  }
  if (previous === 'simple') {
    return { tier: 'moderate', isBoosted: false }
  }
  if (!isBoosted) {
    return { tier: previous, isBoosted: true }
  }
  if (previous === 'complex') {
    return { tier: previous, isBoosted: true }
  }
  return { tier: tierAbove(previous), isBoosted: false }
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

// Desktop draws a Button natively and a raw color on its label is not kept, so the
// model's color is drawn as a small SVG there, as usage-band-plus does. Light and dark
// mode each get a tint of the hue that reads on its background.
const SVG_STYLE =
  '<style>' +
  'text{font-family:Inter,"SF Pro Text",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;font-weight:500}' +
  '.ink{fill:var(--l)}.mute{fill:#8b8f97;font-weight:400}.track{fill:var(--h);fill-opacity:.22}' +
  '@media (prefers-color-scheme:dark){.ink{fill:var(--d)}.mute{fill:#9aa0a8}}' +
  '</style>'

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svgDoc(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" style="color-scheme:light dark;background:transparent">` +
    `${SVG_STYLE}${body}</svg>`
  )
}

function tintVars(hex: string): string {
  return `--l:${lighten(hex, -0.38)};--d:${lighten(hex, 0.25)};--h:${hex}`
}

// The footer label, e.g. `◆ opus`, in the model's color
function labelSvg(label: string, hex: string | null, isDim: boolean): string {
  const width = Math.ceil(label.length * 7.6 + 4)
  const style = hex === null ? '' : ` style="${tintVars(hex)}"`
  const kind = hex === null ? 'mute' : 'ink'
  const opacity = isDim ? ' opacity=".6"' : ''
  return svgDoc(
    width,
    20,
    `<text x="0" y="15" class="${kind}"${style}${opacity}>${escapeXml(label)}</text>`,
  )
}

// The panel's three model rows: bar, name, tier word. The row last picked is bold.
function rowsSvg(tier: ModelTier | null, isEnabled: boolean): string {
  const parts: string[] = []
  ROWS.forEach((row, i) => {
    const y = 4 + i * 22
    const isPicked = tier === row
    const isFaded = !isEnabled || (tier !== null && !isPicked)
    const hex = MODEL_COLOR[row]
    const group: string[] = []
    barCells(row).forEach((cell, n) => {
      const x = n * 13
      if (cell.color === TRACK) {
        group.push(
          `<rect x="${x}" y="${y + 3}" width="10" height="10" rx="2" class="track" style="--h:${hex}"/>`,
        )
      } else {
        group.push(
          `<rect x="${x}" y="${y + 3}" width="10" height="10" rx="2" fill="${cell.color}"/>`,
        )
      }
    })
    const weight = isPicked && isEnabled ? ' font-weight="700"' : ''
    group.push(
      `<text x="48" y="${y + 13}" class="ink" style="${tintVars(hex)}"${weight}>${MODEL_OF[row]}</text>`,
      `<text x="100" y="${y + 13}" class="mute">${row}</text>`,
    )
    parts.push(`<g${isFaded ? ' opacity=".5"' : ''}>${group.join('')}</g>`)
  })
  return svgDoc(168, 70, parts.join(''))
}

export const register: Register = on => {
  // turnId -> model picked for that turn, and whether to raise its effort; every
  // step of the turn uses it.
  const picks = new Map<string, { model: string; isBoosted: boolean }>()

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
    const wasBoosted = await read($, boost)
    const answer = await $.model
      .classify(CLASSIFY_HINT + text.slice(0, 4000), LABELS)
      .catch(() => undefined)
    const label = asLabel(answer)
    let tier: ModelTier
    let isBoosted = false
    if (label === 'retry') {
      const rung = escalate(previous, wasBoosted)
      tier = rung.tier
      isBoosted = rung.isBoosted
    } else if (previous !== null && wordCount(text) < SHORT_WORDS) {
      // A short follow-up ("yes, do it") stays on the model doing the work.
      tier = previous
      isBoosted = wasBoosted
    } else if (label === undefined) {
      // No usable answer: keep the previous tier, or start on opus as the guide advises.
      tier = previous ?? 'complex'
    } else {
      tier = label
    }
    picks.set(e.turnId, { model: MODEL_OF[tier], isBoosted })
    await update($, lastTier, () => tier)
    await update($, boost, () => isBoosted)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const pick = e.agentId === undefined ? picks.get(e.turnId) : undefined
    if (pick === undefined) {
      return yield* next(e)
    }
    const effort = pick.isBoosted ? effortAbove(e.effort) : undefined
    if (effort === undefined) {
      return yield* next({ ...e, model: pick.model })
    }
    return yield* next({ ...e, model: pick.model, effort })
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
    const isBoosted = await read($, boost)
    // A trailing + marks a turn sent with raised effort.
    const pick = tier === null ? 'auto' : `${MODEL_OF[tier]}${isBoosted ? '+' : ''}`
    const color = isEnabled && tier !== null ? MODEL_COLOR[tier] : undefined

    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Box: Row, Button: Press, Text: Name } = $.ui.resolve(e)
      const label = isEnabled ? `◆ ${pick}` : '◇ auto off'
      return (
        <Row key="auto-model" flexDirection="row" alignItems="center">
          {await next(e)}
          <Name color={color ?? GREEN} dimColor={!isEnabled}>
            {label}
          </Name>
          <Press
            key="auto-model-button"
            plain
            label=" ▲"
            onPress={() => update($, isOpen, value => !value)}
          />
        </Row>
      )
    }

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
            <Text color={color ?? GREEN}>{`◆ ${pick} ▲`}</Text>
          ) : (
            <Text dimColor>◇ auto off ▲</Text>
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
    const isEnabled = await read($, isOn)
    const tier = await read($, lastTier)
    const switchOn = async () => {
      const wanted = !(await read($, isOn))
      await update($, isOn, () => wanted)
      await $.store.set(STORE_KEY, wanted)
    }
    const closePanel = () => update($, isOpen, () => false)

    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const pick = tier === null ? 'no pick yet' : MODEL_OF[tier]
      return (
        <Box flexDirection="column" alignItems="flex-end">
          <Box flexDirection="column" alignSelf="flex-end" paddingX={1}>
            <Box flexDirection="row" columnGap={2} alignItems="center">
              <Text bold>auto model</Text>
              <Button
                key="auto-model-switch"
                variant={isEnabled ? 'primary' : 'secondary'}
                label={isEnabled ? '● on' : '○ off'}
                onPress={switchOn}
              />
              <Button key="auto-model-close" plain label="×" onPress={closePanel} />
            </Box>
            <Svg
              source={rowsSvg(tier, isEnabled)}
              alt={`auto model: ${pick}; opus complex, sonnet moderate, haiku simple`}
              width={168}
              height={70}
            />
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const isNarrow = e.props.bodyColumns < NARROW

    return (
      <Box flexDirection="column" alignItems="flex-end">
        <Box flexDirection="column" alignSelf="flex-end" paddingX={1}>
          <Box flexDirection="row" columnGap={2}>
            <Text bold>auto model</Text>
            <Button key="auto-model-switch" plain onPress={switchOn}>
              {isEnabled ? (
                <Text color={GREEN} bold>
                  ● on
                </Text>
              ) : (
                <Text dimColor>○ off</Text>
              )}
            </Button>
            <Button key="auto-model-close" plain onPress={closePanel}>
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
