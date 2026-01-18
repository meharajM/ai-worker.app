import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import { ErrorBoundary } from './components/ErrorBoundary'

console.log('Renderer entry: main.tsx loaded')
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
)
