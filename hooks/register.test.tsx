import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const MODE = {
  plugin: 'auto-model',
  component: 'SessionMode',
  props: { modes: [] },
} as const

type Seen = { models: string[]; efforts?: (string | number | undefined)[] }

async function step($: any, turnId: string, index: number, agentId?: string) {
  const e = { turnId, index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1, ...(agentId ? { agentId } : {}) }
  const stream = $.turn.step(e)
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

function engine(on: any, seen: Seen, label: { value: string | undefined }) {
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('model.classify', () => ({ value: label.value }))
  on('command.register', () => ({ value: { command: 'auto-model' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_: unknown, e: any) {
    seen.models.push(e.model)
    seen.efforts?.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

const LONG = 'Please redesign the whole persistence layer of this service so that it supports sharding and write-ahead logging'

test('a complex prompt routes every step of its turn to opus', async ($, on) => {
  const seen: Seen = { models: [] }
  const label = { value: 'complex' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: LONG, turnId: 't1' })
  await step($, 't1', 0)
  await step($, 't1', 1)
  expect(seen.models).toEqual(['opus', 'opus'])
})

test('a short follow-up keeps the previous tier', async ($, on) => {
  const seen: Seen = { models: [] }
  const label = { value: 'complex' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: LONG, turnId: 't1' })
  label.value = 'simple'
  await $.turn.start({ text: 'yes do it', turnId: 't2' })
  await step($, 't2', 0)
  expect(seen.models).toEqual(['opus'])
})

test('a simple prompt goes to haiku; a subagent step is left alone', async ($, on) => {
  const seen: Seen = { models: [] }
  const label = { value: 'simple' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'What does the ls command print in a directory listing here?', turnId: 't1' })
  await step($, 't1', 0)
  await step($, 't1', 1, 'agent-1')
  expect(seen.models).toEqual(['haiku', 'claude-opus-5-5'])
})

test('off: the model is unchanged; the dropdown toggle turns it off', async ($, on) => {
  const seen: Seen = { models: [] }
  const label = { value: 'complex' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  await ui.press({ key: 'auto-model-button' })
  await ui.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'auto-model-switch' })
  const toggle = await band.find({ key: 'auto-model-switch' })
  expect(toggle?.text).toMatch(/off/)
  await band.unmount()
  await $.turn.start({ text: LONG, turnId: 't1' })
  await step($, 't1', 0)
  expect(seen.models).toEqual(['claude-opus-5-5'])
})

test('the panel lists the three models, and drops the extras when narrow', async ($, on) => {
  const seen: Seen = { models: [] }
  const label = { value: 'complex' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...MODE, surface: 'terminal' })
  await ui.press({ key: 'auto-model-button' })
  await ui.unmount()
  const wide = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await wide.find({ type: 'Text', text: /opus/ })).toBeDefined()
  expect(await wide.find({ type: 'Text', text: /moderate/ })).toBeDefined()
  await wide.unmount()
  const narrow = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, bodyColumns: 20 },
    surface: 'terminal',
  })
  expect(await narrow.find({ type: 'Text', text: /opus/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /moderate/ })).toBeUndefined()
  await narrow.unmount()
})

test('on desktop the model color is drawn as an SVG, not as button text', async ($, on) => {
  const seen: Seen = { models: [] }
  const label = { value: 'complex' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: LONG, turnId: 't1' })
  const footer = await $.ui.mount({ ...MODE, surface: 'desktop' })
  const name = await footer.find({ type: 'Text', text: /opus/ })
  expect(name).toBeDefined()
  expect(JSON.stringify(name)).toContain('#D97757')
  await footer.press({ key: 'auto-model-button' })
  await footer.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const rows = await band.find({ type: 'Svg' })
  expect(JSON.stringify(rows)).toContain('#6A9BCC')
  await band.unmount()
})

async function turn($: any, turnId: string, text: string) {
  await $.turn.start({ text, turnId })
  await step($, turnId, 0)
}

const MID = 'Add a --verbose flag to the build script that prints each step'

test('retry raises effort on the same model first, then moves up a model', async ($, on) => {
  const seen: Seen = { models: [], efforts: [] }
  const label = { value: 'moderate' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 't1', MID)
  label.value = 'retry'
  await turn($, 't2', 'That is wrong, the flag does nothing at all, please try again')
  await turn($, 't3', 'Still not working after your second attempt at this flag')
  expect(seen.models).toEqual(['sonnet', 'sonnet', 'opus'])
  expect(seen.efforts).toEqual(['medium', 'high', 'medium'])
})

test('retry after haiku goes straight to sonnet', async ($, on) => {
  const seen: Seen = { models: [], efforts: [] }
  const label = { value: 'simple' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 't1', 'What does the ls command print in a directory listing here?')
  label.value = 'retry'
  await turn($, 't2', 'still wrong')
  expect(seen.models).toEqual(['haiku', 'sonnet'])
  expect(seen.efforts).toEqual(['medium', 'medium'])
})

test('a short prompt escalates on retry but otherwise keeps the tier', async ($, on) => {
  const seen: Seen = { models: [], efforts: [] }
  const label = { value: 'moderate' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 't1', MID)
  label.value = 'simple'
  await turn($, 't2', 'ok go on')
  label.value = 'retry'
  await turn($, 't3', 'try again')
  label.value = 'simple'
  await turn($, 't4', 'yes')
  expect(seen.models).toEqual(['sonnet', 'sonnet', 'sonnet', 'sonnet'])
  expect(seen.efforts).toEqual(['medium', 'medium', 'high', 'high'])
})

test('no usable answer: opus at first, then the previous tier', async ($, on) => {
  const seen: Seen = { models: [], efforts: [] }
  const label = { value: undefined as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 't1', 'hi')
  label.value = 'simple'
  await turn($, 't2', 'What does the ls command print in a directory listing here?')
  label.value = 'nonsense'
  await turn($, 't3', 'And what does the pwd command print in a terminal here?')
  expect(seen.models).toEqual(['opus', 'haiku', 'haiku'])
})

test('a new non-retry label clears the raised effort', async ($, on) => {
  const seen: Seen = { models: [], efforts: [] }
  const label = { value: 'complex' as string | undefined }
  engine(on, seen, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await turn($, 't1', LONG)
  label.value = 'retry'
  await turn($, 't2', 'That still fails the same way as before, try once more')
  label.value = 'moderate'
  await turn($, 't3', MID)
  expect(seen.models).toEqual(['opus', 'opus', 'sonnet'])
  expect(seen.efforts).toEqual(['medium', 'high', 'medium'])
})
