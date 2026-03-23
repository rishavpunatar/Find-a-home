import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import './index.css'
import { DataProvider } from './context/DataContext'
import { SettingsProvider } from './context/SettingsContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <DataProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
)
