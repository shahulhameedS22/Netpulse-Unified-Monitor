import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronsDown, Gauge, Radio, Sparkles } from 'lucide-react';
import { NavTab } from './Navigation';

interface NextTestPromptProps {
  /** The app the user can switch to. */
  target: Extract<NavTab, 'speedtest' | 'ping'>;
  /** Switches to the other app (App.tsx setCurrentTab). */
  onLaunch: (tab: NavTab) => void;
  /**
   * True if the attention animation has already been played earlier in this
   * visit (held in App.tsx memory, so a refresh / reopen resets it).
   */
  animationAlreadyUsed: boolean;
  /** Called once when this prompt appears, so App.tsx can mark the animation as used. */
  onShown: () => void;
}

const COPY = {
  ping: {
    title: 'Want to check latency as well?',
    text: 'Your speed test is finished. Run the Ping Monitor to probe packet loss and latency from all four regions.',
    button: 'Launch Ping Monitoring App',
    pill: 'Next: Ping Monitoring',
    Icon: Radio,
    accent: {
      card: 'border-indigo-500/40',
      icon: 'bg-indigo-500/15 border-indigo-400/30 text-indigo-300',
      button:
        'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-indigo-600/25',
    },
  },
  speedtest: {
    title: 'Want to measure real speed as well?',
    text: 'Your ping check is finished. Run the Speed Test to measure download, upload and jitter for all four regions.',
    button: 'Launch Speed Test App',
    pill: 'Next: Speed Test',
    Icon: Gauge,
    accent: {
      card: 'border-cyan-500/40',
      icon: 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300',
      button: 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/25',
    },
  },
} as const;

/**
 * Shown at the bottom of an app page ONLY after a test has finished in that app.
 *
 * - First completed test of the visit: animated (slide-up, glowing ring, nudging
 *   arrow) plus a floating bouncing pill that pulls the user down the page.
 * - Every later completed test in the same visit: plain card + launch button,
 *   no animation.
 */
export const NextTestPrompt: React.FC<NextTestPromptProps> = ({
  target,
  onLaunch,
  animationAlreadyUsed,
  onShown,
}) => {
  // Decide ONCE, at the moment the prompt first appears. Marking the animation as
  // "used" later must not switch it off halfway through.
  const [animate] = useState(() => !animationAlreadyUsed);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardVisible, setCardVisible] = useState(false);

  useEffect(() => {
    onShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide the floating pill as soon as the card itself is on screen.
  useEffect(() => {
    if (!animate || !cardRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCardVisible(entry.isIntersecting),
      { threshold: 0.35 }
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [animate]);

  const copy = COPY[target];
  const Icon = copy.Icon;

  return (
    <>
      <div
        ref={cardRef}
        className={`rounded-2xl p-6 sm:p-7 bg-gradient-to-r from-[#141e33] via-[#16233f] to-[#122b44] border ${copy.accent.card} shadow-2xl ${
          animate ? 'np-card-intro' : ''
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${copy.accent.icon}`}
            >
              <Icon className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-2">
                {copy.title}
                {animate && <Sparkles className="w-4 h-4 text-amber-300" />}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed">{copy.text}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onLaunch(target);
              window.scrollTo({ top: 0 });
            }}
            className={`shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-extrabold text-sm text-white shadow-lg transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${copy.accent.button}`}
          >
            <span>{copy.button}</span>
            <ArrowRight className={`w-4 h-4 ${animate ? 'np-arrow-nudge' : ''}`} />
          </button>
        </div>
      </div>

      {/* Floating cue, first completed test only. Rendered in <body> so no parent
          transform can break position:fixed. Disappears once the card is in view. */}
      {animate &&
        !cardVisible &&
        createPortal(
          <button
            type="button"
            onClick={() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 cursor-pointer"
            aria-label={`Scroll down: ${copy.pill}`}
          >
            <span className="np-bounce-down inline-flex items-center gap-2 px-5 py-3 rounded-full text-sm font-extrabold text-white bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 shadow-2xl shadow-cyan-500/40 border border-white/20">
              <span>Test complete. {copy.pill}</span>
              <ChevronsDown className="w-4 h-4" />
            </span>
          </button>,
          document.body
        )}
    </>
  );
};
