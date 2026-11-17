import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'

type PhoneScreen = 'home' | 'calls' | 'messages' | 'gallery' | 'photo'

const MESSAGES = [
  { from: 'Jay', text: 'come out. one drink.', time: '9:41 PM' },
  { from: 'You', text: 'one drink.', time: '9:44 PM' },
  { from: 'Jay', text: 'you put the key in a rock and took a picture like that would help', time: '1:08 AM' },
  { from: 'You', text: 'it will help', time: '1:09 AM' },
  { from: 'Jay', text: 'it will not help. every rock looks like that.', time: '11:16 AM' },
]

export function Phone() {
  const open = useGameStore((s) => s.phoneOpen)
  const [screen, setScreen] = useState<PhoneScreen>('home')

  useEffect(() => {
    if (!open) setScreen('home')
  }, [open])

  const back = () => {
    if (screen === 'photo') setScreen('gallery')
    else setScreen('home')
  }

  return (
    <div className={`phone-dock ${open ? 'is-open' : ''}`}>
      <div className="phone-device" role="dialog" aria-label="Phone">
        <div className="phone-bezel">
          <div className="phone-screen">
            <div className="phone-status">
              <span>1:07</span>
              <span className="phone-island" />
              <span>LTE</span>
            </div>

            {screen === 'home' && (
              <div className="phone-home">
                <p className="phone-wallpaper-label">Last night is still on here.</p>
                <div className="phone-apps">
                  <button type="button" className="phone-app" onClick={() => setScreen('calls')}>
                    <span className="app-icon app-calls">☎</span>
                    Calls
                  </button>
                  <button type="button" className="phone-app" onClick={() => setScreen('messages')}>
                    <span className="app-icon app-messages">✉</span>
                    Messages
                    <span className="app-badge">1</span>
                  </button>
                  <button type="button" className="phone-app" onClick={() => setScreen('gallery')}>
                    <span className="app-icon app-gallery">▣</span>
                    Gallery
                  </button>
                </div>
              </div>
            )}

            {screen === 'calls' && (
              <div className="phone-page">
                <header className="phone-page-bar">
                  <button type="button" onClick={back}>Back</button>
                  <strong>Recents</strong>
                </header>
                <article className="call-row">
                  <p>Jay</p>
                  <span>Last night · 47 min · you do not remember this call</span>
                </article>
              </div>
            )}

            {screen === 'messages' && (
              <div className="phone-page">
                <header className="phone-page-bar">
                  <button type="button" onClick={back}>Back</button>
                  <strong>Jay</strong>
                </header>
                <div className="thread">
                  {MESSAGES.map((message) => (
                    <p key={message.time} className={message.from === 'You' ? 'bubble mine' : 'bubble'}>
                      {message.text}
                      <span>{message.time}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {screen === 'gallery' && (
              <div className="phone-page">
                <header className="phone-page-bar">
                  <button type="button" onClick={back}>Back</button>
                  <strong>Gallery</strong>
                </header>
                <button type="button" className="photo-thumb" onClick={() => setScreen('photo')}>
                  <RockPhoto />
                  <span>Rock.jpg · 1:07 AM</span>
                </button>
              </div>
            )}

            {screen === 'photo' && (
              <div className="phone-page photo-view">
                <header className="phone-page-bar">
                  <button type="button" onClick={back}>Gallery</button>
                  <strong>Rock.jpg</strong>
                </header>
                <RockPhoto />
                <p className="photo-caption">Flash. 1:07 AM. It looks like every other rock.</p>
              </div>
            )}
          </div>
          <button
            type="button"
            className="phone-homebar"
            aria-label="Home"
            onClick={() => setScreen('home')}
          />
        </div>
        <p className="phone-hint">I to put it away</p>
      </div>
    </div>
  )
}

function RockPhoto() {
  const stones = [
    [18, 62, 16], [40, 70, 12], [62, 58, 18], [84, 74, 14],
    [28, 40, 11], [50, 46, 20], [74, 42, 13], [90, 56, 10],
    [12, 28, 9], [34, 22, 13], [58, 24, 11], [78, 18, 15],
    [46, 78, 10], [68, 82, 12], [22, 80, 8],
  ] as const
  return (
    <svg className="rock-photo" viewBox="0 0 100 100" role="img" aria-label="A flash photo of grey gravel">
      <defs>
        <radialGradient id="flash" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#f4f1ea" />
          <stop offset="55%" stopColor="#8d8680" />
          <stop offset="100%" stopColor="#2a2724" />
        </radialGradient>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" />
          <feColorMatrix type="saturate" values="0" />
          <feBlend in="SourceGraphic" mode="multiply" />
        </filter>
      </defs>
      <rect width="100" height="100" fill="url(#flash)" />
      {stones.map(([x, y, r]) => (
        <ellipse key={`${x}-${y}`} cx={x} cy={y} rx={r} ry={r * 0.72} fill="#7a756f" stroke="#4e4a46" strokeWidth="0.6" />
      ))}
      <ellipse cx="50" cy="48" rx="20" ry="14" fill="#8a847c" stroke="#3f3c38" strokeWidth="0.8" />
      <ellipse cx="44" cy="44" rx="6" ry="3" fill="#c8c2b8" opacity="0.7" />
      <rect width="100" height="100" filter="url(#grain)" opacity="0.28" />
    </svg>
  )
}
