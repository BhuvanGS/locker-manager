import { useGameStore, type DialogueView } from '../store/gameStore'

/**
 * Conversation with the customer at the counter.
 * The natural next step is pre-highlighted: just press E. Scroll or W/S to pick another, 1–6 to jump
 * straight to one. With the mouse free, options are also clickable.
 */
export function DialoguePanel({ dialogue }: { dialogue: DialogueView }) {
  const patch = useGameStore((s) => s.patch)
  const selected = useGameStore((s) => s.dialogueIndex)
  const lines = dialogue.lines.slice(-4)

  return (
    <div className="dialogue" role="dialog" aria-label={`Talking to ${dialogue.speaker}`}>
      <p className="dialogue-speaker">{dialogue.speaker}</p>
      {lines.length > 0 && (
        <ul className="dialogue-lines">
          {lines.map((line, i) => (
            <li key={`${i}-${line.text}`} className={line.who === 'You' ? 'you' : 'them'}>
              <span className="who">{line.who === 'You' ? 'You' : dialogue.speaker}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      )}
      <ol className="dialogue-options" role="listbox" aria-label="Your reply">
        {dialogue.options.map((option, i) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : undefined}
              disabled={option.disabled !== null}
              title={option.disabled ?? undefined}
              onClick={() => patch({ pendingChoice: option.id })}
            >
              <kbd>{i + 1}</kbd>
              <span className="option-label">{option.label}</span>
              {option.disabled ? (
                <em>{option.disabled}</em>
              ) : (
                option.recommended && <span className="next-tag">next</span>
              )}
            </button>
          </li>
        ))}
      </ol>
      <p className="dialogue-keys">
        <kbd>E</kbd> confirm · <kbd>W</kbd>
        <kbd>S</kbd> or scroll to choose · <kbd>1</kbd>–<kbd>6</kbd> quick pick · <kbd>Q</kbd> step away
      </p>
    </div>
  )
}
