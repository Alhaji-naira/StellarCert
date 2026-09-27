/**
 * ExecutionBytecodeInspector.tsx
 *
 * Governance proposal component that lets developers paste raw XDR bytecode
 * and instantly see:
 *  - Decoded contract address, function signature, and arguments (< 100 ms)
 *  - Syntax-highlighted JSON view of call parameters
 *  - Copyable raw XDR string button
 *  - "Simulate Execution Dry-Run" button — calls the Soroban testnet RPC and
 *    displays a detailed execution result trace in a modal console
 *
 * Usage:
 *   <ExecutionBytecodeInspector proposalXdr="AAAAAQAA..." />
 *
 * When used standalone (no proposalXdr prop), an editable textarea is shown
 * so the inspector can be used as a developer tool.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DryRunConsoleModal from './DryRunConsoleModal';
import { decodeXdr, simulateDryRun } from './xdrDecoder';
import type { DecodedContractCall, DryRunOutcome, XdrDecodeOutcome } from './xdrDecoder';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExecutionBytecodeInspectorProps {
  /**
   * Base-64 encoded XDR for the proposal's execution transaction.
   * When provided the inspector runs in read-only mode (no textarea).
   * When omitted a developer textarea is shown for manual input.
   */
  proposalXdr?: string;
  /** Optional proposal title shown in the header */
  proposalTitle?: string;
  /** Optional class names applied to the root element */
  className?: string;
}

// ─── Syntax-highlighting helpers (no external library) ───────────────────────

/**
 * Tokenise a JSON string into coloured spans. Uses a simple regex walk
 * so it is dependency-free and runs in < 1 ms for typical payloads.
 */
function JsonHighlight({ json }: { json: string }) {
  const tokens = useMemo(() => tokeniseJson(json), [json]);

  return (
    <pre
      className="text-xs font-mono leading-relaxed overflow-auto"
      style={{
        color: '#e2e8f0',
        tabSize: 2,
        whiteSpace: 'pre',
        wordBreak: 'normal',
      }}
      aria-label="Syntax-highlighted JSON"
    >
      {tokens.map(({ text, kind }, i) => (
        <span key={i} style={{ color: tokenColor(kind) }}>
          {text}
        </span>
      ))}
    </pre>
  );
}

type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'other';

interface Token {
  text: string;
  kind: TokenKind;
}

function tokenColor(kind: TokenKind): string {
  switch (kind) {
    case 'key':        return '#93c5fd'; // blue-300
    case 'string':     return '#86efac'; // green-300
    case 'number':     return '#fbbf24'; // amber-400
    case 'boolean':    return '#c084fc'; // purple-400
    case 'null':       return '#f87171'; // red-400
    case 'punctuation':return '#94a3b8'; // slate-400
    default:           return '#e2e8f0';
  }
}

function tokeniseJson(json: string): Token[] {
  const tokens: Token[] = [];
  // Regex captures: key strings, value strings, numbers, booleans, null, punctuation
  const re = /"(\\.|[^"\\])*"(?=\s*:)|"(\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]|\s+/g;

  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = re.exec(json)) !== null) {
    // Any gap (shouldn't happen with valid JSON but guard anyway)
    if (match.index > lastIndex) {
      tokens.push({ text: json.slice(lastIndex, match.index), kind: 'other' });
    }

    const raw = match[0];

    let kind: TokenKind = 'other';
    if (/^\s+$/.test(raw)) {
      kind = 'other';
    } else if (/^".*"$/.test(raw) && json[re.lastIndex] === undefined) {
      // JSON key detection via the lookahead in the regex pattern
      kind = 'string';
    } else if (/^"/.test(raw)) {
      // Distinguish between keys (followed by :) and strings
      const afterMatch = json.slice(re.lastIndex).trimStart();
      kind = afterMatch.startsWith(':') ? 'key' : 'string';
    } else if (/^-?\d/.test(raw)) {
      kind = 'number';
    } else if (raw === 'true' || raw === 'false') {
      kind = 'boolean';
    } else if (raw === 'null') {
      kind = 'null';
    } else if (/^[{}[\],:]$/.test(raw)) {
      kind = 'punctuation';
    }

    tokens.push({ text: raw, kind });
    lastIndex = re.lastIndex;
  }

  if (lastIndex < json.length) {
    tokens.push({ text: json.slice(lastIndex), kind: 'other' });
  }

  return tokens;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Monospace truncated address with a full tooltip via title attr */
function AddressChip({ address, label }: { address: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const el = document.createElement('textarea');
      el.value = address;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const short = address.length > 16
    ? `${address.slice(0, 8)}…${address.slice(-8)}`
    : address;

  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: '#6b7280' }}
      >
        {label}
      </span>
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <span
          className="font-mono text-xs flex-1 truncate"
          style={{ color: '#93c5fd' }}
          title={address}
        >
          {short}
        </span>
        <button
          onClick={copy}
          title={`Copy ${label}`}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-all duration-150 shrink-0"
          style={{
            background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
            color: copied ? '#4ade80' : '#6b7280',
            border: `1px solid ${copied ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}
          aria-label={copied ? 'Copied' : `Copy ${label}`}
        >
          {copied ? (
            <>
              <CheckIcon size={10} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon size={10} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** Single argument row in the call parameters table */
function ArgRow({
  index,
  type,
  value,
}: {
  index: number;
  type: string;
  value: unknown;
}) {
  const jsonStr = useMemo(
    () => JSON.stringify(value, null, 2),
    [value],
  );

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Arg header */}
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ background: 'rgba(255,255,255,0.03)' }}
      >
        <span
          className="text-xs font-mono font-semibold w-5 text-center shrink-0"
          style={{ color: '#4b5563' }}
        >
          {index}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{
            background: 'rgba(14,165,233,0.1)',
            color: '#38bdf8',
            border: '1px solid rgba(14,165,233,0.2)',
          }}
        >
          {type}
        </span>
      </div>
      {/* Arg value */}
      <div
        className="px-4 py-3 overflow-x-auto"
        style={{
          background: 'rgba(0,0,0,0.25)',
          maxHeight: '200px',
          overflowY: 'auto',
        }}
      >
        <JsonHighlight json={jsonStr} />
      </div>
    </div>
  );
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SpinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function AlertIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CodeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExecutionBytecodeInspector({
  proposalXdr,
  proposalTitle,
  className = '',
}: ExecutionBytecodeInspectorProps) {
  // ── Input state (used only in standalone / dev-tool mode) ──────────────
  const [inputXdr, setInputXdr] = useState(proposalXdr ?? '');
  const activeXdr = proposalXdr !== undefined ? proposalXdr : inputXdr;

  // ── Decode result ─────────────────────────────────────────────────────
  const [decodeResult, setDecodeResult] = useState<XdrDecodeOutcome | null>(null);
  const [decodeMs, setDecodeMs] = useState<number | null>(null);

  // ── Copy XDR state ────────────────────────────────────────────────────
  const [xdrCopied, setXdrCopied] = useState(false);

  // ── Dry-run state ─────────────────────────────────────────────────────
  const [isSimulating, setIsSimulating] = useState(false);
  const [dryRunOutcome, setDryRunOutcome] = useState<DryRunOutcome | null>(null);
  const [dryRunElapsedMs, setDryRunElapsedMs] = useState<number | undefined>(undefined);
  const [showConsole, setShowConsole] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Tab within the JSON view ──────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'args' | 'full'>('args');

  // ── Decode whenever activeXdr changes ────────────────────────────────
  useEffect(() => {
    if (!activeXdr.trim()) {
      setDecodeResult(null);
      setDecodeMs(null);
      return;
    }
    const result = decodeXdr(activeXdr.trim());
    setDecodeResult(result);
    setDecodeMs(result.durationMs);
  }, [activeXdr]);

  // ── Copy XDR ─────────────────────────────────────────────────────────
  const handleCopyXdr = useCallback(async () => {
    const xdr = activeXdr.trim();
    if (!xdr) return;
    try {
      await navigator.clipboard.writeText(xdr);
    } catch {
      const el = document.createElement('textarea');
      el.value = xdr;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setXdrCopied(true);
    setTimeout(() => setXdrCopied(false), 2500);
  }, [activeXdr]);

  // ── Simulate dry-run ─────────────────────────────────────────────────
  const handleDryRun = useCallback(async () => {
    const xdr = activeXdr.trim();
    if (!xdr || isSimulating) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsSimulating(true);
    setDryRunOutcome(null);
    setShowConsole(true);

    const outcome = await simulateDryRun(xdr);

    setDryRunOutcome(outcome);
    setDryRunElapsedMs(outcome.durationMs);
    setIsSimulating(false);
  }, [activeXdr, isSimulating]);

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Derived data ──────────────────────────────────────────────────────
  const decoded: DecodedContractCall | null =
    decodeResult?.success ? decodeResult.data : null;

  const fullCallJson = useMemo(() => {
    if (!decoded) return '';
    return JSON.stringify(
      {
        contractAddress: decoded.contractAddress,
        functionName: decoded.functionName,
        arguments: decoded.args.map((a) => ({ index: a.index, type: a.type, value: a.value })),
        sourceAccount: decoded.sourceAccount ?? null,
      },
      null,
      2,
    );
  }, [decoded]);

  const hasXdr = activeXdr.trim().length > 0;

  // ─────────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes inspectorFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .inspector-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .inspector-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .inspector-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.08);
          border-radius: 9999px;
        }
      `}</style>

      <div
        className={`rounded-2xl overflow-hidden ${className}`}
        style={{
          background: 'linear-gradient(160deg, #0d1117 0%, #0a0e14 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          animation: 'inspectorFadeIn 0.35s ease',
          fontFamily: "'Inter', ui-sans-serif, system-ui",
        }}
        role="region"
        aria-label="Execution Bytecode Inspector"
      >
        {/* ── Top accent bar ────────────────────────────────────────── */}
        <div
          className="h-px w-full"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(14,165,233,0.6), rgba(139,92,246,0.5), transparent)',
          }}
        />

        {/* ── Header ───────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap items-start justify-between gap-4 px-6 pt-5 pb-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(14,165,233,0.2), rgba(139,92,246,0.2))',
                border: '1px solid rgba(14,165,233,0.25)',
              }}
            >
              <CodeIcon size={16} />
            </div>
            <div>
              <h2
                className="text-sm font-semibold leading-tight"
                style={{ color: '#f1f5f9' }}
              >
                {proposalTitle ?? 'Execution Bytecode Inspector'}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: '#4b5563' }}>
                Decode and inspect Soroban contract invocation XDR
              </p>
            </div>
          </div>

          {/* Header action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Copy XDR button */}
            <button
              onClick={handleCopyXdr}
              disabled={!hasXdr}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: xdrCopied ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${xdrCopied ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                color: xdrCopied ? '#4ade80' : '#9ca3af',
              }}
              aria-label="Copy raw XDR string"
            >
              {xdrCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              {xdrCopied ? 'XDR Copied!' : 'Copy XDR'}
            </button>

            {/* Simulate button */}
            <button
              onClick={handleDryRun}
              disabled={!hasXdr || isSimulating || decodeResult?.success === false}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: isSimulating
                  ? 'rgba(139,92,246,0.25)'
                  : 'linear-gradient(135deg, rgba(14,165,233,0.85), rgba(139,92,246,0.85))',
                border: '1px solid rgba(14,165,233,0.35)',
                color: '#ffffff',
                boxShadow: isSimulating ? 'none' : '0 4px 14px rgba(14,165,233,0.2)',
              }}
              aria-label="Simulate execution dry-run on testnet"
            >
              {isSimulating ? <SpinIcon size={12} /> : <PlayIcon size={12} />}
              {isSimulating ? 'Simulating…' : 'Simulate Dry-Run'}
            </button>
          </div>
        </div>

        {/* ── XDR Input (standalone / dev-tool mode only) ───────────── */}
        {proposalXdr === undefined && (
          <div
            className="px-6 pt-4 pb-0"
          >
            <label
              htmlFor="xdr-input"
              className="block text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: '#4b5563' }}
            >
              Paste XDR
            </label>
            <textarea
              id="xdr-input"
              value={inputXdr}
              onChange={(e) => setInputXdr(e.target.value)}
              placeholder="AAAAAQAAAA…  (base-64 encoded TransactionEnvelope or InvokeHostFunction XDR)"
              rows={4}
              spellCheck={false}
              className="w-full resize-y rounded-xl px-4 py-3 text-xs font-mono leading-relaxed outline-none transition-colors duration-150 inspector-scrollbar"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: '#e2e8f0',
                caretColor: '#38bdf8',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(14,165,233,0.4)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
              aria-label="XDR input"
            />
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5">

          {/* Empty state */}
          {!hasXdr && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div
                className="flex items-center justify-center w-12 h-12 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <CodeIcon size={20} />
              </div>
              <p className="text-sm" style={{ color: '#374151' }}>
                {proposalXdr === undefined
                  ? 'Paste XDR above to begin decoding'
                  : 'No XDR provided for this proposal'}
              </p>
            </div>
          )}

          {/* Decode error */}
          {hasXdr && decodeResult && !decodeResult.success && (
            <div
              className="flex items-start gap-3 px-4 py-4 rounded-xl"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
              role="alert"
            >
              <div className="shrink-0 mt-0.5" style={{ color: '#f87171' }}>
                <AlertIcon size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold mb-1" style={{ color: '#f87171' }}>
                  Failed to decode XDR
                </p>
                <p className="text-xs font-mono leading-relaxed" style={{ color: '#fca5a5' }}>
                  {decodeResult.error}
                </p>
              </div>
            </div>
          )}

          {/* Decode success */}
          {decoded && (
            <div
              className="space-y-4"
              style={{ animation: 'inspectorFadeIn 0.25s ease' }}
            >
              {/* Performance badge */}
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: '#374151' }}
                >
                  Decoded Contract Call
                </span>
                {decodeMs !== null && (
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(34,197,94,0.1)',
                      border: '1px solid rgba(34,197,94,0.2)',
                      color: '#4ade80',
                    }}
                  >
                    ✓ decoded in {decodeMs.toFixed(2)} ms
                  </span>
                )}
              </div>

              {/* Contract address + source account */}
              <div className="grid gap-3 sm:grid-cols-2">
                <AddressChip address={decoded.contractAddress} label="Contract Address" />
                {decoded.sourceAccount && (
                  <AddressChip address={decoded.sourceAccount} label="Source Account" />
                )}
              </div>

              {/* Function signature */}
              <div className="flex flex-col gap-1">
                <span
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: '#6b7280' }}
                >
                  Function Signature
                </span>
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{
                    background: 'rgba(139,92,246,0.08)',
                    border: '1px solid rgba(139,92,246,0.2)',
                  }}
                >
                  {/* Function name */}
                  <span className="font-mono text-sm font-semibold" style={{ color: '#c4b5fd' }}>
                    {decoded.functionName}
                  </span>
                  <span style={{ color: '#4b5563' }}>(</span>
                  {decoded.args.length === 0 ? (
                    <span style={{ color: '#4b5563' }}>)</span>
                  ) : (
                    <>
                      {decoded.args.map((a, i) => (
                        <span key={a.index} className="font-mono text-xs" style={{ color: '#94a3b8' }}>
                          <span style={{ color: '#38bdf8' }}>{a.type}</span>
                          {i < decoded.args.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                      <span style={{ color: '#4b5563' }}>)</span>
                    </>
                  )}
                  {/* Arg count badge */}
                  <span
                    className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: 'rgba(139,92,246,0.15)',
                      color: '#a78bfa',
                      border: '1px solid rgba(139,92,246,0.25)',
                    }}
                  >
                    {decoded.args.length} arg{decoded.args.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Tabs: individual args vs. full JSON */}
              {decoded.args.length > 0 && (
                <div className="flex flex-col gap-3">
                  {/* Tab bar */}
                  <div
                    className="flex gap-1 p-1 rounded-xl self-start"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                    role="tablist"
                    aria-label="JSON view mode"
                  >
                    {(['args', 'full'] as const).map((tab) => (
                      <button
                        key={tab}
                        role="tab"
                        aria-selected={activeTab === tab}
                        onClick={() => setActiveTab(tab)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                        style={{
                          background: activeTab === tab ? 'rgba(14,165,233,0.15)' : 'transparent',
                          color: activeTab === tab ? '#38bdf8' : '#4b5563',
                          border: activeTab === tab ? '1px solid rgba(14,165,233,0.2)' : '1px solid transparent',
                        }}
                      >
                        {tab === 'args' ? 'Arguments' : 'Full Call JSON'}
                      </button>
                    ))}
                  </div>

                  {/* Arguments tab */}
                  {activeTab === 'args' && (
                    <div
                      className="space-y-2 inspector-scrollbar"
                      style={{ maxHeight: '420px', overflowY: 'auto' }}
                      role="tabpanel"
                    >
                      {decoded.args.map((arg) => (
                        <ArgRow
                          key={arg.index}
                          index={arg.index}
                          type={arg.type}
                          value={arg.value}
                        />
                      ))}
                    </div>
                  )}

                  {/* Full JSON tab */}
                  {activeTab === 'full' && (
                    <div
                      className="relative rounded-xl overflow-hidden inspector-scrollbar"
                      style={{
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        maxHeight: '420px',
                        overflowY: 'auto',
                      }}
                      role="tabpanel"
                    >
                      <div className="px-5 py-4">
                        <JsonHighlight json={fullCallJson} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* No-args notice */}
              {decoded.args.length === 0 && (
                <p className="text-xs font-mono text-center py-3" style={{ color: '#374151' }}>
                  Function takes no arguments.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        {hasXdr && (
          <div
            className="flex items-center justify-between px-6 py-3 flex-wrap gap-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <span className="text-xs font-mono" style={{ color: '#1f2937' }}>
              stellar · soroban contract invocation · testnet dry-run available
            </span>
            {dryRunOutcome && (
              <button
                onClick={() => setShowConsole(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors duration-150"
                style={{
                  background: dryRunOutcome.success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${dryRunOutcome.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  color: dryRunOutcome.success ? '#4ade80' : '#f87171',
                }}
              >
                {dryRunOutcome.success ? <CheckIcon size={11} /> : <AlertIcon size={11} />}
                {dryRunOutcome.success ? 'Simulation passed' : 'Simulation failed'}
                &nbsp;· View trace
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Dry-run console modal ─────────────────────────────────── */}
      <DryRunConsoleModal
        isOpen={showConsole}
        onClose={() => setShowConsole(false)}
        outcome={isSimulating ? null : dryRunOutcome}
        elapsedMs={dryRunElapsedMs}
      />
    </>
  );
}
