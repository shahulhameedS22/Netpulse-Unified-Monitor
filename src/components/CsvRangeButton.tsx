import React, { useState } from 'react';
import { CalendarClock, Download } from 'lucide-react';
import { browserTimeZone, saveCsv, stamp } from '../lib/csvDownload';

/** "CSV by date & time": downloads the saved history of this test type between two moments. */
export function CsvRangeButton({ kind }: { kind: 'speed' | 'ping' }) {
  const local = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => local(startOfToday()));
  const [to, setTo] = useState(() => local(new Date()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const preset = (hours: number | 'today') => {
    const end = new Date();
    setTo(local(end));
    setFrom(local(hours === 'today' ? startOfToday() : new Date(end.getTime() - hours * 3_600_000)));
    setMsg(null);
  };

  const download = async () => {
    const f = new Date(from).getTime();
    const t = Math.min(new Date(to).getTime(), Date.now());
    if (!Number.isFinite(f) || !Number.isFinite(t)) { setMsg({ ok: false, text: 'Choose both the start and the end date and time.' }); return; }
    if (f >= t) { setMsg({ ok: false, text: 'The start must be before the end.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams({ kind, from: String(f), to: String(t), tz: browserTimeZone() });
      const res = await fetch(`/api/metrics/export.csv?${qs}`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `The download failed (HTTP ${res.status}).`);
      }
      const text = await res.text();
      const lines = text.split('\n');
      if (lines.length <= 1) { setMsg({ ok: false, text: 'No saved results between these two times. Try a wider range.' }); return; }
      saveCsv(`netpulse-${kind}-${stamp(f)}-to-${stamp(t)}`, lines);
      setMsg({ ok: true, text: `Downloaded ${lines.length - 1} result${lines.length === 2 ? '' : 's'}.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'The download failed.' });
    } finally {
      setBusy(false);
    }
  };

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-700 text-slate-200 hover:bg-slate-800/80 cursor-pointer';
  const field = 'w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 [color-scheme:dark]';

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={btn} aria-expanded={open}>
        <CalendarClock className="w-3.5 h-3.5" /> CSV by date &amp; time
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl space-y-3 text-left">
          <div className="flex flex-wrap gap-1.5">
            {([['Today', 'today'], ['Last 24 h', 24], ['Last 7 days', 168]] as const).map(([label, v]) => (
              <button key={label} type="button" onClick={() => preset(v)} className="px-2 py-1 rounded-md text-[11px] font-bold text-slate-300 border border-slate-700 hover:bg-slate-800 cursor-pointer">{label}</button>
            ))}
          </div>
          <label className="block text-[11px] font-bold text-slate-400">From
            <input type="datetime-local" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setMsg(null); }} className={`${field} mt-1`} />
          </label>
          <label className="block text-[11px] font-bold text-slate-400">To
            <input type="datetime-local" value={to} max={local(new Date())} onChange={(e) => { setTo(e.target.value); setMsg(null); }} className={`${field} mt-1`} />
          </label>
          {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-400' : 'text-rose-300'}`}>{msg.text}</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">Times are in your time zone.</span>
            <button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 cursor-pointer">
              <Download className="w-3.5 h-3.5" /> {busy ? 'Preparing...' : 'Download'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
