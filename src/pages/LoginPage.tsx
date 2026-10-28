import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { AdminProvisionModal } from './AdminProvisionModal';
import {
  Activity,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ShieldCheck,
  ArrowRight,
  KeyRound,
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { signIn, authError, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [isAdminProvisionOpen, setIsAdminProvisionOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Please enter your work email.');
      return;
    }
    if (!password) {
      setValidationError('Please enter your account password.');
      return;
    }

    setLoading(true);
    try {
      await signIn(trimmedEmail, password);
    } catch {
      // Error is set in AuthContext and rendered
    } finally {
      setLoading(false);
    }
  };

  const displayError = validationError || authError;

  const regionalBadges = [
    { code: 'IN', name: 'IN-DC01', style: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40' },
    { code: 'IN', name: 'IN-DC02', style: 'bg-blue-500/20 text-blue-300 border-blue-400/40' },
    { code: 'SL', name: 'LK-DC01', style: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' },
    { code: 'SG', name: 'SG-DC01', style: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40' },
  ];

  return (
    <div className="min-h-screen bg-[#0b1329] text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Background radial effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        {/* Brand Header */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-400 via-blue-500 to-indigo-600 p-0.5 shadow-xl shadow-cyan-500/20">
            <div className="w-full h-full bg-[#0c1424] rounded-[14px] flex items-center justify-center">
              <Activity className="w-7 h-7 text-cyan-400 stroke-[2.2]" />
            </div>
          </div>
        </div>

        <h1 className="text-center text-2xl sm:text-3xl font-black tracking-tight text-white">
          Network Operations Center
        </h1>
        <p className="mt-2 text-center text-xs sm:text-sm text-slate-300 font-medium">
          Unified Speed Test &amp; Multi-Region Ping Monitor
        </p>

        {/* 4 Regional Nodes Indicator with IN, IN, SL, SG */}
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {regionalBadges.map((node) => (
            <span
              key={node.name}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold border ${node.style}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>{node.code}</span>
              <span className="text-slate-400 font-normal">({node.name})</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-700/80 mb-6">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span>Operator Authentication</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-emerald-300 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Firebase Secured
            </span>
          </div>

          {displayError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 font-semibold leading-relaxed">{displayError}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="operator@network.internal"
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#0c1424] border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setIsForgotPasswordOpen(true)}
                  className="text-xs text-cyan-300 hover:text-cyan-200 font-semibold transition-colors cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#0c1424] border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white transition-colors cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-extrabold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:via-blue-500 hover:to-indigo-500 text-white shadow-xl shadow-cyan-500/25 transition-all cursor-pointer disabled:opacity-50 hover:scale-[1.01] active:scale-[0.99]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Admin Onboarding notice */}
          <div className="mt-6 pt-5 border-t border-slate-700/80 flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">First time setup or new operator?</span>
            <button
              onClick={() => setIsAdminProvisionOpen(true)}
              type="button"
              className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 font-bold transition-colors cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Admin Setup</span>
            </button>
          </div>
        </div>

        {/* Security & System Info Footer */}
        <div className="mt-6 text-center space-y-2">
          <p className="text-xs text-slate-300 flex items-center justify-center gap-1.5 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Authorized Network Infrastructure Monitoring System</span>
          </p>
          <div className="text-[11px] text-cyan-200 font-mono flex items-center justify-center gap-3">
            <span>Direct LibreSpeed Relay</span>
            <span>•</span>
            <span>ICMP 8.8.8.8 Native Probes</span>
            <span>•</span>
            <span>Zero Simulated Metrics</span>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
      />

      <AdminProvisionModal
        isOpen={isAdminProvisionOpen}
        onClose={() => setIsAdminProvisionOpen(false)}
        onSuccess={() => {
          // Handled automatically through auth state change
        }}
      />
    </div>
  );
};
