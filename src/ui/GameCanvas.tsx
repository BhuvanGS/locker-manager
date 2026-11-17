import { useEffect, useRef } from 'react'
import { Engine } from '../engine/Engine'
import { useGameStore } from '../store/gameStore'

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const phase = useGameStore((s) => s.phase)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new Engine(canvas)
    engineRef.current = engine
    let disposed = false

    void engine.init().then(() => {
      if (!disposed) engine.start()
    })

    return () => {
      disposed = true
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setPaused(phase === 'paused' || phase === 'menu' || phase === 'won' || phase === 'caught')
  }, [phase])

  return <canvas ref={canvasRef} className="game-canvas" id="game-canvas" tabIndex={0} />
}