import React from 'react';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Gauge,
  Radio,
  Server,
  LogOut,
  User,
  Activity,
  Menu,
  X,
  Shield,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'speedtest' | 'ping' | 'endpoints';

interface NavigationProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  speedTestRunning?: boolean;
  pingTestRunning?: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onSelectTab,
  speedTestRunning = false,
  pingTestRunning = false,
}) => {
  const { user, profile, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'NOC Dashboard',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'speedtest' as NavTab,
      label: 'Speed Test',
      icon: Gauge,
      badge: speedTestRunning ? 'RUNNING' : null,
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse',
    },
    {
      id: 'ping' as NavTab,
      label: 'Ping Monitoring',
      icon: Radio,
      badge: pingTestRunning ? 'PROBING' : null,
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse',
    },
    {
      id: 'endpoints' as NavTab,
      label: 'Regional Nodes',
      icon: Server,
      badge: '',
      badgeColor: 'bg-slate-800 text-slate-400 border-slate-700',
    },
  ];

  const handleSelect = (tab: NavTab) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#0f172a]/95 backdrop-blur-xl border-b border-slate-700/80 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSelect('dashboard')}
              className="flex items-center gap-2.5 text-left group cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-600 p-0.5 shadow-md shadow-cyan-500/20">
                <div className="w-full h-full bg-[#0c1424] rounded-[10px] flex items-center justify-center">
                  <Activity className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
                </div>
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-black text-white tracking-tight leading-none">
                  Network Monitor
                </div>
                <div className="text-[10px] font-mono font-bold text-cyan-400 mt-0.5">
                  Unified Operations Center
                </div>
              </div>
            </button>
          </div>

          {/* Desktop Nav Items */}
          <nav className="hidden md:flex items-center gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  type="button"
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm shadow-cyan-500/10'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md border font-bold ${item.badgeColor}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* User Profile & Logout */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141e33] border border-slate-700/80 shadow-xs">
              <div className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-xs font-bold">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white leading-tight truncate max-w-[130px]">
                  {profile?.fullName || user?.email?.split('@')[0] || 'Operator'}
                </div>
                <div className="text-[9px] font-mono font-bold text-slate-300 flex items-center gap-1">
                  <Shield className="w-2.5 h-2.5 text-cyan-400" />
                  <span>Authenticated</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => signOut()}
              type="button"
              title="Sign Out"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-600/40 border border-rose-500/30 transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
              aria-label="Toggle Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-slate-950 px-4 pt-3 pb-5 space-y-2 animate-fade-in">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  type="button"
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 text-cyan-400" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${item.badgeColor}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Signed in as <strong className="text-white">{user?.email}</strong>
            </div>
            <button
              onClick={() => signOut()}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
