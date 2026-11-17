import { useEffect, useRef } from 'react'
import { Engine } from '../engine/Engine'

/** Hosts the WebGL canvas and owns the Engine's lifetime. */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = new Engine(canvas)
    let disposed = false
    void engine.init().then(() => {
      if (!disposed) engine.start()
    })
    return () => {
      disposed = true
      engine.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" id="game-canvas" tabIndex={0} />
}
