import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// În popup-ul extensiei fereastra are mărime fixă (vezi html.popup în App.css);
// deschisă într-un tab sau pe serverul de dev se întinde pe toată fereastra.
const extensionApi = globalThis.browser ?? globalThis.chrome;
if (extensionApi?.extension?.getViews?.({ type: 'popup' }).includes(window)) {
  document.documentElement.classList.add('popup')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
