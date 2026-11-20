/** `?debug=1` (or localStorage `lm-debug` = "1") exposes `window.__game` and the FPS counter. */
export function isDebugEnabled(): boolean {
  // Never in the published build: the handle can grant money, levels and upgrades.
  if (typeof window === 'undefined' || !import.meta.env.DEV) return false
  const v = new URLSearchParams(window.location.search).get('debug')
  if (v === '' || v === '1' || v === 'true') return true
  try {
    return localStorage.getItem('lm-debug') === '1'
  } catch {
    return false
  }
}
