/**
 * DryRunConsoleModal.tsx
 *
 * Displays the full Soroban simulation trace returned by simulateDryRun()
 * in a terminal-style console modal. Matches the dark glass aesthetic used
 * throughout StellarCert (QRCodeModal / CertificatePreviewModal patterns).
 */

import { useCallback, useState } from 'react';
import type { DryRunOutcome, StateChange } from './xdrDecoder';

interface DryRunConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  outcome: DryRunOutcome | null;
  /** Elapsed ms for the simulation call */
  elapsedMs?: number;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: 'green' | 'red' | 'yellow' | 'blue';
}) {
  const palette: Record<string, { bg: string; border: string; text: string }> = {
    green: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', text: '#4ade80' },
    red: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: '#f87171' },
    yellow: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.3)', text: '#facc15' },
    blue: { bg: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.3)', text: '#38bdf8' },
  };
  const p = palette[color];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold tracking-wide"
      style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.text }}
    >
      {children}
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <span className="text-xs font-medium uppercase tracking-widest" style={{ color: '#6b7280' }}>
        {label}
      </span>
      <span className="text-sm font-mono font-semibold" style={{ color: '#e2e8f0' }}>
        {value}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: '#4b5563' }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function StateChangeBadge({ type }: { type: StateChange['type'] }) {
  const map = {
    created: { label: 'CREATED', color: 'green' as const },
    updated: { label: 'UPDATED', color: 'yellow' as const },
    deleted: { label: 'DELETED', color: 'red' as const },
  };
  const entry = map[type] ?? { label: type.toUpperCase(), color: 'blue' as const };
  return <Badge color={entry.color}>{entry.label}</Badge>;
}

/** Truncate a long base64 string for display */
function truncate(str: string, max = 48): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DryRunConsoleModal({
  isOpen,
  onClose,
  outcome,
  elapsedMs,
}: DryRunConsoleModalProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedSection(key);
    setTimeout(() => setCopiedSection(null), 2000);
  }, []);

  if (!isOpen) return null;

  const isSuccess = outcome?.success === true;
  const sim = isSuccess ? outcome.result : null;

  return (
    <>
      <style>{`
        @keyframes consoleSlideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes consoleFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .console-scrollbar::-webkit-scrollbar { width: 6px; }
        .console-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .console-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 9999px;
        }
      `}</style>

      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Dry-run simulation result"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          onClick={onClose}
          style={{ animation: 'consoleFadeIn 0.2s ease' }}
        />

        {/* Panel */}
        <div
          className="relative w-full max-w-3xl flex flex-col"
          style={{
            maxHeight: '90vh',
            animation: 'consoleSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <div
            className="relative flex flex-col overflow-hidden rounded-2xl"
            style={{
              background: 'linear-gradient(160deg, #0d1117 0%, #0a0e14 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 40px 100px rgba(0,0,0,0.85)',
            }}
          >
            {/* Top accent */}
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{
                background: isSuccess
                  ? 'linear-gradient(90deg, transparent, rgba(34,197,94,0.7), rgba(14,165,233,0.5), transparent)'
                  : 'linear-gradient(90deg, transparent, rgba(239,68,68,0.7), transparent)',
              }}
            />

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                {/* Terminal traffic lights */}
                <div className="flex gap-1.5">
                  {['#ef4444', '#f59e0b', '#22c55e'].map((c) => (
                    <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.8 }} />
                  ))}
                </div>
                <span className="text-xs font-mono tracking-widest uppercase" style={{ color: '#4b5563' }}>
                  soroban-rpc://testnet — simulateTransaction
                </span>
              </div>

              <div className="flex items-center gap-2">
                {outcome && (
                  <Badge color={isSuccess ? 'green' : 'red'}>
                    {isSuccess ? '✓ SUCCESS' : '✗ ERROR'}
                  </Badge>
                )}
                {elapsedMs !== undefined && (
                  <span className="text-xs font-mono" style={{ color: '#4b5563' }}>
                    {elapsedMs.toFixed(0)} ms
                  </span>
                )}
                <button
                  onClick={onClose}
                  className="flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-150"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#6b7280'; }}
                  aria-label="Close"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body — scrollable */}
            <div className="overflow-y-auto console-scrollbar px-6 pb-6 space-y-5" style={{ maxHeight: '72vh' }}>

              {/* ── No outcome yet ── */}
              {!outcome && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span className="text-sm font-mono" style={{ color: '#4b5563' }}>Waiting for simulation…</span>
                </div>
              )}

              {/* ── Error ── */}
              {outcome && !isSuccess && (
                <div
                  className="rounded-xl p-5 font-mono text-sm leading-relaxed"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: '#ef4444' }}>
                    Simulation failed
                  </p>
                  <pre className="whitespace-pre-wrap break-words" style={{ color: '#fca5a5' }}>
                    {outcome.error}
                  </pre>
                </div>
              )}

              {/* ── Success ── */}
              {sim && (
                <>
                  {/* Metrics row */}
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard
                      label="CPU Instructions"
                      value={Number(sim.cost?.cpuInsns ?? 0).toLocaleString()}
                      sub="instructions used"
                    />
                    <MetricCard
                      label="Memory"
                      value={`${(Number(sim.cost?.memBytes ?? 0) / 1024).toFixed(1)} KB`}
                      sub={`${sim.cost?.memBytes ?? '0'} bytes`}
                    />
                    <MetricCard
                      label="Min Resource Fee"
                      value={`${sim.minResourceFee ?? '0'} stroops`}
                      sub={`≈ ${(Number(sim.minResourceFee ?? 0) / 1e7).toFixed(7)} XLM`}
                    />
                  </div>

                  {/* Return value */}
                  {sim.returnValue !== undefined && (
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6b7280' }}>
                          Return Value
                        </span>
                        <button
                          onClick={() => copyText(sim.returnValue ?? '', 'returnValue')}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors duration-150"
                          style={{
                            background: copiedSection === 'returnValue' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)',
                            color: copiedSection === 'returnValue' ? '#4ade80' : '#6b7280',
                            border: '1px solid rgba(255,255,255,0.07)',
                          }}
                        >
                          {copiedSection === 'returnValue' ? (
                            <><CopyCheckIcon /> Copied</>
                          ) : (
                            <><CopyIcon /> Copy</>
                          )}
                        </button>
                      </div>
                      <pre
                        className="rounded-xl p-4 text-xs font-mono leading-relaxed overflow-x-auto"
                        style={{
                          background: 'rgba(255,255,255,0.025)',
                          border: '1px solid rgba(255,255,255,0.07)',
                          color: '#86efac',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {sim.returnValue}
                      </pre>
                    </section>
                  )}

                  {/* Events */}
                  {sim.events && sim.events.length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6b7280' }}>
                          Contract Events
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded-full text-xs"
                            style={{ background: 'rgba(14,165,233,0.15)', color: '#38bdf8' }}
                          >
                            {sim.events.length}
                          </span>
                        </span>
                      </div>
                      <div className="space-y-2">
                        {sim.events.map((ev, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 px-4 py-3 rounded-xl"
                            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
                          >
                            <span
                              className="mt-0.5 text-xs font-mono shrink-0 w-5 text-center"
                              style={{ color: '#4b5563' }}
                            >
                              {i}
                            </span>
                            <pre className="text-xs font-mono flex-1 overflow-x-auto whitespace-pre-wrap break-words" style={{ color: '#93c5fd' }}>
                              {truncate(ev, 120)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* State changes */}
                  {sim.stateChanges && sim.stateChanges.length > 0 && (
                    <section>
                      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#6b7280' }}>
                        Ledger State Changes
                        <span
                          className="ml-2 px-1.5 py-0.5 rounded-full text-xs"
                          style={{ background: 'rgba(234,179,8,0.12)', color: '#facc15' }}
                        >
                          {sim.stateChanges.length}
                        </span>
                      </span>
                      <div className="mt-2 space-y-2">
                        {sim.stateChanges.map((sc, i) => (
                          <div
                            key={i}
                            className="rounded-xl px-4 py-3 space-y-2"
                            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
                          >
                            <div className="flex items-center gap-2">
                              <StateChangeBadge type={sc.type} />
                              <span className="text-xs font-mono truncate" style={{ color: '#9ca3af' }}>
                                {truncate(sc.key, 60)}
                              </span>
                            </div>
                            {(sc.before || sc.after) && (
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                {sc.before !== undefined && (
                                  <div>
                                    <p className="text-xs mb-1" style={{ color: '#4b5563' }}>Before</p>
                                    <pre className="text-xs font-mono p-2 rounded-lg whitespace-pre-wrap break-words" style={{ background: 'rgba(0,0,0,0.3)', color: '#f87171' }}>
                                      {truncate(sc.before)}
                                    </pre>
                                  </div>
                                )}
                                {sc.after !== undefined && (
                                  <div>
                                    <p className="text-xs mb-1" style={{ color: '#4b5563' }}>After</p>
                                    <pre className="text-xs font-mono p-2 rounded-lg whitespace-pre-wrap break-words" style={{ background: 'rgba(0,0,0,0.3)', color: '#4ade80' }}>
                                      {truncate(sc.after)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Empty events / state changes notice */}
                  {(!sim.events || sim.events.length === 0) &&
                    (!sim.stateChanges || sim.stateChanges.length === 0) && (
                      <p className="text-xs font-mono text-center py-4" style={{ color: '#374151' }}>
                        No events or state changes emitted.
                      </p>
                    )}
                </>
              )}
            </div>

            {/* Footer */}
            <div
              className="shrink-0 flex items-center justify-between px-6 py-4"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <span className="text-xs font-mono" style={{ color: '#1f2937' }}>
                stellar testnet · read-only simulation · no fees charged
              </span>
              <button
                onClick={onClose}
                className="text-xs px-4 py-2 rounded-xl font-medium transition-colors duration-150"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#9ca3af',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Inline icon components (avoids lucide import churn) ──────────────────────

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CopyCheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
