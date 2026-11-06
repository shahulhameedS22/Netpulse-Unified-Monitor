/**
 * Unified Network Monitoring Application
 * Combines Network Speed Test & Ping Monitoring into a single secure platform.
 */

import React, { useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { Navigation, NavTab } from './components/Navigation';
import { UnifiedDashboardPage } from './pages/UnifiedDashboardPage';
import { SpeedTestPage } from './pages/SpeedTestPage';
import { PingMonitorPage } from './pages/PingMonitorPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { EndpointsPage } from './pages/EndpointsPage';
import { Loader2, Activity } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [speedTestRunning, setSpeedTestRunning] = useState(false);
  const [pingTestRunning, setPingTestRunning] = useState(false);

  const [nextStepAnimationUsed, setNextStepAnimationUsed] = useState(false);
  const markNextStepAnimationUsed = useCallback(() => setNextStepAnimationUsed(true), []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b1329] flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-400 flex items-center justify-center animate-pulse shadow-lg shadow-cyan-500/20">
            <Activity className="w-6 h-6 animate-spin" />
          </div>
          <div className="text-sm font-bold text-white tracking-wide">Verifying Operator Session...</div>
          <div className="text-xs text-slate-300 font-mono">Firebase Authentication</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-[#0b1329] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navigation
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        speedTestRunning={speedTestRunning}
        pingTestRunning={pingTestRunning}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {currentTab === 'dashboard' && (
          <UnifiedDashboardPage
            onSelectTab={setCurrentTab}
            speedTestRunning={speedTestRunning}
            pingTestRunning={pingTestRunning}
          />
        )}

        {currentTab === 'speedtest' && (
          <SpeedTestPage
            onTestRunningChange={setSpeedTestRunning}
            onSelectTab={setCurrentTab}
            nextStepAnimationUsed={nextStepAnimationUsed}
            onNextStepShown={markNextStepAnimationUsed}
          />
        )}

        {currentTab === 'ping' && (
          <PingMonitorPage
            onTestRunningChange={setPingTestRunning}
            onSelectTab={setCurrentTab}
            nextStepAnimationUsed={nextStepAnimationUsed}
            onNextStepShown={markNextStepAnimationUsed}
          />
        )}

        {currentTab === 'monitoring' && <MonitoringPage />}

        {currentTab === 'endpoints' && <EndpointsPage />}
      </main>

      <footer className="border-t border-slate-700/80 bg-[#0f172a] py-6 text-center text-xs text-slate-300">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono">
          <div className="font-semibold text-slate-200">Unified Network Operations Center • India (IN) | Sri Lanka (SL) | Singapore (SG)</div>
          <div className="text-slate-400">LibreSpeed v5.2.5 • ICMP Probing Engine • Zero Fake Metrics</div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}
