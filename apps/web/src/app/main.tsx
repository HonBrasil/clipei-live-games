import '../styles/dashboard.css';
import '../styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.tsx';
import { AppProvider } from './state.tsx';
import { Landing } from './pages/Landing.tsx';
import { Login } from './pages/Login.tsx';
import { Home } from './pages/Home.tsx';
import { Games } from './pages/Games.tsx';
import { BossPage } from './pages/BossPage.tsx';
import { OverlayPage } from './pages/OverlayPage.tsx';
import { Connections } from './pages/Connections.tsx';
import { TestPage } from './pages/TestPage.tsx';
import { PlanPage } from './pages/PlanPage.tsx';
import { Account } from './pages/Account.tsx';
import { Admin } from './pages/Admin.tsx';
import { RacePage } from './pages/RacePage.tsx';
import { DuelPage } from './pages/DuelPage.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/entrar" element={<Login />} />
        <Route
          path="/app"
          element={
            <AppProvider>
              <AppShell />
            </AppProvider>
          }
        >
          <Route index element={<Home />} />
          <Route path="jogos" element={<Games />} />
          <Route path="jogos/boss" element={<BossPage />} />
          <Route path="jogos/race" element={<RacePage />} />
          <Route path="jogos/corrida" element={<RacePage />} />
          <Route path="jogos/duel" element={<DuelPage />} />
          <Route path="jogos/duelo" element={<DuelPage />} />
          <Route path="overlay" element={<OverlayPage />} />
          <Route path="conexoes" element={<Connections />} />
          <Route path="testar" element={<TestPage />} />
          <Route path="plano" element={<PlanPage />} />
          <Route path="conta" element={<Account />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
