# auto-model

<img src="assets/icon.png" width="128" alt="auto-model icon">

A Claude Code mod that picks the model for each turn from the complexity of your prompt.

When it is on, a cheap call to the small fast model rates each prompt as simple, moderate or complex. Every request in that turn then runs on the matching model:

| Complexity | Model |
|---|---|
| simple | haiku |
| moderate | sonnet |
| complex | opus |

Prompts shorter than 6 words (for example "yes, do it") keep the previous turn's model, so a short follow-up inside a hard task does not drop to the smallest model. Subagents keep the session's model. If the rating call fails, a word-count rule is used instead.

## Use

A button sits at the bottom-right of the footer under the prompt box, showing the model last picked (`◆ opus ▾`) or `◇ auto off ▾`. Click it to open a small panel above the prompt with the on/off toggle. The setting is remembered across sessions and defaults to on.

You can also run `/auto-model on`, `/auto-model off`, or `/auto-model` to flip it.

Note: the switch is made per request, so `/model` and the status line keep showing your session model; the button shows the one actually used.

## Install

```
/plugin install auto-model --marketplace NeoNeuron/auto-model
```

Answer `y` to add the marketplace, then pick a scope.

## License

MIT © 2026 Kai Chen
