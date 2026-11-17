import { useGameStore, type DialogueView } from '../store/gameStore'

/** Conversation with the customer at the counter. Answer with number keys, or click when the mouse is free. */
export function DialoguePanel({ dialogue }: { dialogue: DialogueView }) {
  const patch = useGameStore((s) => s.patch)
  return (
    <div className="dialogue" role="dialog" aria-label={`Talking to ${dialogue.speaker}`}>
      <p className="dialogue-speaker">{dialogue.speaker}</p>
      {dialogue.lines.length > 0 && (
        <ul className="dialogue-lines">
          {dialogue.lines.slice(-4).map((line, i) => (
            <li key={`${i}-${line.text}`} className={line.who === 'You' ? 'you' : 'them'}>
              <span className="who">{line.who === 'You' ? 'You' : dialogue.speaker}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      )}
      <ol className="dialogue-options">
        {dialogue.options.map((option, i) => (
          <li key={option.id}>
            <button
              type="button"
              disabled={option.disabled !== null}
              title={option.disabled ?? undefined}
              onClick={() => patch({ pendingChoice: option.id })}
            >
              <kbd>{i + 1}</kbd>
              <span>{option.label}</span>
              {option.disabled && <em>{option.disabled}</em>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
