/** `?debug=1` (or localStorage `lm-debug` = "1") exposes `window.__game` and the FPS counter. */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const v = new URLSearchParams(window.location.search).get('debug')
  if (v === '' || v === '1' || v === 'true') return true
  try {
    return localStorage.getItem('lm-debug') === '1'
  } catch {
    return false
  }
}
