import React from 'react';
import { TEST_ENDPOINTS, TestEndpoint } from '../config/endpoints';
import { X, Server, Code, Info } from 'lucide-react';

interface EndpointConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedEndpoint: TestEndpoint;
}

export const EndpointConfigModal: React.FC<EndpointConfigModalProps> = ({
  isOpen,
  onClose,
  selectedEndpoint,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-fade-in">
      <div className="bg-[#141e33] border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 relative">
        <div className="flex items-center justify-between pb-4 border-b border-slate-700/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/30">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">LibreSpeed Endpoint Architecture</h3>
              <p className="text-xs text-slate-300">Dedicated endpoints for Port 8443 speed benchmarking</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="p-3.5 rounded-xl bg-[#0c1424] border border-cyan-500/30 text-xs text-cyan-200 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">LibreSpeed Contract:</strong> All tests run against external endpoints using:
              <ul className="mt-1 space-y-0.5 list-disc list-inside text-cyan-300 font-mono text-[11px]">
                <li>Ping / Jitter: GET /empty.php</li>
                <li>Download: GET /garbage.php?ckSize=15</li>
                <li>Upload: POST /empty.php</li>
              </ul>
              Zero simulated latency or mock data. Tests require reachable servers with CORS enabled.
            </div>
          </div>

          {/* List of 4 endpoints and their configured URLs */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Configured Endpoints (4 Regional Nodes)
            </span>
            <div className="space-y-2.5">
              {TEST_ENDPOINTS.map((ep) => (
                <div
                  key={ep.id}
                  className={`p-3.5 rounded-xl border text-xs transition-all ${
                    ep.id === selectedEndpoint.id
                      ? 'bg-[#182645] border-cyan-400/60 shadow-lg shadow-cyan-900/20'
                      : 'bg-[#0c1424] border-slate-700/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Server className={`w-3.5 h-3.5 ${ep.id === selectedEndpoint.id ? 'text-cyan-400' : 'text-slate-400'}`} />
                      <span className="font-bold text-white">{ep.name}</span>
                      <span className="text-cyan-300 font-mono font-bold">({ep.serverCode})</span>
                    </div>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-md bg-slate-800 border border-slate-700 font-bold text-slate-200">
                      {ep.countryCode} Node
                    </span>
                  </div>

                  <div className="space-y-1 font-mono text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-slate-400 w-16">Base URL:</span>
                      <span className="text-amber-300 font-semibold truncate">{ep.baseUrl}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-slate-400 w-16">Ping:</span>
                      <span className="text-slate-200 truncate">{ep.pingUrl}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-slate-400 w-16">Download:</span>
                      <span className="text-slate-200 truncate">{ep.downloadUrl}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <span className="text-slate-400 w-16">Upload:</span>
                      <span className="text-slate-200 truncate">{ep.uploadUrl}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer border border-slate-600"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
