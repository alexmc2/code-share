import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider } from './lib/session.js';
import { ThemeProvider } from './components/ThemeProvider.tsx';
import { LandingPage } from './pages/LandingPage';
import { SessionPage } from './pages/SessionPage';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SessionProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
          </Routes>
        </SessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
