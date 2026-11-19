import { createRoot } from 'react-dom/client'
import '@fontsource/bungee/400.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import './styles/global.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
