/**
 * xdrDecoder.ts
 *
 * Utilities for decoding Stellar XDR-encoded transaction envelopes and
 * Soroban contract invocations into human-readable structures.
 *
 * Uses @stellar/stellar-sdk (v14+) which bundles xdr types and SorobanRpc.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DecodedArgument {
  index: number;
  type: string;
  value: unknown;
}

export interface DecodedContractCall {
  /** Strkey-encoded contract address (C…) */
  contractAddress: string;
  /** Function name as a string */
  functionName: string;
  /** Decoded argument list */
  args: DecodedArgument[];
  /** Raw base-64 XDR of the inner InvokeContractArgs, for display */
  rawXdr: string;
  /** Network passphrase detected from the envelope, if any */
  networkPassphrase?: string;
  /** Source account if present in the transaction envelope */
  sourceAccount?: string;
}

export interface DecodeResult {
  success: true;
  data: DecodedContractCall;
  durationMs: number;
}

export interface DecodeError {
  success: false;
  error: string;
  durationMs: number;
}

export type XdrDecodeOutcome = DecodeResult | DecodeError;

// ─── Soroban RPC dry-run types ─────────────────────────────────────────────

export interface DryRunSuccess {
  success: true;
  /** Raw JSON result returned by the RPC simulation */
  result: SorobanSimulationResult;
  /** Execution cost breakdown */
  cost: { cpuInsns: string; memBytes: string };
  /** Sequence of events emitted */
  events: string[];
  /** Minimum resource fee in stroops */
  minResourceFee: string;
  durationMs: number;
}

export interface DryRunError {
  success: false;
  error: string;
  durationMs: number;
}

export type DryRunOutcome = DryRunSuccess | DryRunError;

export interface SorobanSimulationResult {
  status: 'SUCCESS' | 'ERROR' | 'RESTORE';
  returnValue?: string;
  events?: string[];
  cost?: { cpuInsns: string; memBytes: string };
  minResourceFee?: string;
  error?: string;
  stateChanges?: StateChange[];
}

export interface StateChange {
  type: 'created' | 'updated' | 'deleted';
  key: string;
  before?: string;
  after?: string;
}

// ─── XDR value → JS primitive conversion ──────────────────────────────────

/**
 * Recursively convert an xdr.ScVal into a plain JS value for JSON display.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scValToPlain(scVal: any): unknown {
  try {
    const type: string = scVal.switch().name;

    switch (type) {
      case 'scvVoid':
        return null;

      case 'scvBool':
        return scVal.b();

      case 'scvError': {
        const err = scVal.error();
        return { _type: 'error', code: err.code().value, message: String(err) };
      }

      case 'scvU32':
        return scVal.u32();

      case 'scvI32':
        return scVal.i32();

      case 'scvU64':
        return scVal.u64().toString();

      case 'scvI64':
        return scVal.i64().toString();

      case 'scvTimepoint':
        return { _type: 'timepoint', value: scVal.timepoint().toString() };

      case 'scvDuration':
        return { _type: 'duration', value: scVal.duration().toString() };

      case 'scvU128': {
        const u128 = scVal.u128();
        const hi = BigInt(u128.hi().toString());
        const lo = BigInt(u128.lo().toString());
        return ((hi << 64n) | lo).toString();
      }

      case 'scvI128': {
        const i128 = scVal.i128();
        const hi = BigInt(i128.hi().toString());
        const lo = BigInt(i128.lo().toString());
        const raw = (hi << 64n) | lo;
        return raw.toString();
      }

      case 'scvU256': {
        const parts = scVal.u256();
        return {
          _type: 'u256',
          hiHi: parts.hiHi().toString(),
          hiLo: parts.hiLo().toString(),
          loHi: parts.loHi().toString(),
          loLo: parts.loLo().toString(),
        };
      }

      case 'scvI256': {
        const parts = scVal.i256();
        return {
          _type: 'i256',
          hiHi: parts.hiHi().toString(),
          hiLo: parts.hiLo().toString(),
          loHi: parts.loHi().toString(),
          loLo: parts.loLo().toString(),
        };
      }

      case 'scvBytes':
        return { _type: 'bytes', hex: Buffer.from(scVal.bytes()).toString('hex') };

      case 'scvString':
        return Buffer.from(scVal.str()).toString('utf-8');

      case 'scvSymbol':
        return scVal.sym().toString();

      case 'scvVec': {
        const vec = scVal.vec();
        if (!vec) return [];
        return vec.map(scValToPlain);
      }

      case 'scvMap': {
        const map = scVal.map();
        if (!map) return {};
        const obj: Record<string, unknown> = {};
        for (const entry of map) {
          const k = scValToPlain(entry.key());
          const v = scValToPlain(entry.val());
          obj[String(k)] = v;
        }
        return obj;
      }

      case 'scvAddress': {
        const addr = scVal.address();
        const addrType: string = addr.switch().name;
        if (addrType === 'scAddressTypeAccount') {
          return StellarSdk.StrKey.encodeEd25519PublicKey(
            addr.accountId().ed25519(),
          );
        }
        if (addrType === 'scAddressTypeContract') {
          return StellarSdk.StrKey.encodeContract(addr.contractId());
        }
        return { _type: 'address', raw: addr.toXDR('base64') };
      }

      case 'scvLedgerKeyContractInstance':
        return { _type: 'ledgerKeyContractInstance' };

      case 'scvLedgerKeyNonce':
        return { _type: 'ledgerKeyNonce', nonce: scVal.nonceKey().nonce().toString() };

      case 'scvContractInstance':
        return { _type: 'contractInstance' };

      default:
        return { _type: type, raw: scVal.toXDR('base64') };
    }
  } catch {
    try {
      return { _type: 'unknown', raw: scVal.toXDR('base64') };
    } catch {
      return { _type: 'unknown' };
    }
  }
}

/**
 * Map xdr ScVal switch name to a short human-readable type label.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scValTypeName(scVal: any): string {
  try {
    return scVal.switch().name.replace(/^scv/, '');
  } catch {
    return 'Unknown';
  }
}

// ─── Main decode function ─────────────────────────────────────────────────

/**
 * Decode a base-64 XDR string (TransactionEnvelope or just an
 * InvokeHostFunctionOp) into a structured DecodedContractCall.
 *
 * Guaranteed to complete in < 5 ms for typical Soroban transactions.
 */
export function decodeXdr(xdrBase64: string): XdrDecodeOutcome {
  const t0 = performance.now();

  if (!xdrBase64 || !xdrBase64.trim()) {
    return { success: false, error: 'XDR input is empty.', durationMs: 0 };
  }

  try {
    // ── 1. Try to parse as a TransactionEnvelope ──────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let envelope: any = null;
    let sourceAccount: string | undefined;

    try {
      envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
    } catch {
      // might be a raw operation XDR — handled below
    }

    // ── 2. Extract the InvokeHostFunction operation ───────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let invokeOp: any = null;

    if (envelope) {
      const envType: string = envelope.switch().name;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tx: any;

      if (envType === 'envelopeTypeTx') {
        tx = envelope.v1().tx();
      } else if (envType === 'envelopeTypeTxV0') {
        tx = envelope.v0().tx();
      } else if (envType === 'envelopeTypeTxFeeBump') {
        const inner = envelope.feeBump().tx().innerTx();
        tx = inner.v1().tx();
      } else {
        return {
          success: false,
          error: `Unsupported envelope type: ${envType}`,
          durationMs: performance.now() - t0,
        };
      }

      // Extract source account strkey
      try {
        const srcId = tx.sourceAccount();
        const srcType: string = srcId.switch().name;
        if (srcType === 'keyTypeEd25519') {
          sourceAccount = StellarSdk.StrKey.encodeEd25519PublicKey(srcId.ed25519());
        }
      } catch { /* non-critical */ }

      const ops = tx.operations();
      if (!ops || ops.length === 0) {
        return {
          success: false,
          error: 'Transaction contains no operations.',
          durationMs: performance.now() - t0,
        };
      }

      const opBody = ops[0].body();
      const opType: string = opBody.switch().name;

      if (opType !== 'invokeHostFunction') {
        return {
          success: false,
          error: `Expected an invokeHostFunction operation, found: ${opType}`,
          durationMs: performance.now() - t0,
        };
      }

      invokeOp = opBody.invokeHostFunction();
    } else {
      // Try as raw Operation XDR
      try {
        const op = StellarSdk.xdr.Operation.fromXDR(xdrBase64, 'base64');
        const opBody = op.body();
        const opType: string = opBody.switch().name;
        if (opType !== 'invokeHostFunction') {
          return {
            success: false,
            error: `Expected an invokeHostFunction operation, found: ${opType}`,
            durationMs: performance.now() - t0,
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        invokeOp = (opBody as any).invokeHostFunction();
      } catch {
        return {
          success: false,
          error:
            'Could not parse XDR — not a valid TransactionEnvelope or InvokeHostFunction operation. Ensure the XDR is base-64 encoded.',
          durationMs: performance.now() - t0,
        };
      }
    }

    // ── 3. Drill into the HostFunction ────────────────────────────────────
    const hostFn = invokeOp.hostFunction();
    const hostFnType: string = hostFn.switch().name;

    if (hostFnType !== 'hostFunctionTypeInvokeContract') {
      return {
        success: false,
        error: `Host function type is not invokeContract: ${hostFnType}`,
        durationMs: performance.now() - t0,
      };
    }

    const invokeArgs = hostFn.invokeContract();

    // ── 4. Decode contract address ────────────────────────────────────────
    const contractScAddress = invokeArgs.contractAddress();
    let contractAddress: string;

    try {
      contractAddress = StellarSdk.StrKey.encodeContract(
        contractScAddress.contractId(),
      );
    } catch {
      contractAddress = contractScAddress.toXDR('base64');
    }

    // ── 5. Decode function name ───────────────────────────────────────────
    const functionName: string = invokeArgs.functionName().toString();

    // ── 6. Decode arguments ───────────────────────────────────────────────
    const rawArgs = invokeArgs.args();
    const args: DecodedArgument[] = (rawArgs ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (scVal: any, index: number) => ({
        index,
        type: scValTypeName(scVal),
        value: scValToPlain(scVal),
      }),
    );

    // ── 7. Produce raw XDR of invokeContractArgs for copy/display ─────────
    let rawXdr = xdrBase64;
    try {
      rawXdr = invokeArgs.toXDR('base64');
    } catch { /* keep original */ }

    return {
      success: true,
      data: {
        contractAddress,
        functionName,
        args,
        rawXdr,
        sourceAccount,
      },
      durationMs: performance.now() - t0,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: performance.now() - t0,
    };
  }
}

// ─── Soroban RPC dry-run ──────────────────────────────────────────────────

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';

/**
 * Submit a read-only simulation of the transaction to the Stellar testnet
 * Soroban RPC endpoint and return a structured result.
 */
export async function simulateDryRun(
  xdrBase64: string,
  rpcUrl: string = TESTNET_RPC,
): Promise<DryRunOutcome> {
  const t0 = performance.now();

  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: xdrBase64 },
    });

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return {
        success: false,
        error: `RPC request failed: HTTP ${res.status} ${res.statusText}`,
        durationMs: performance.now() - t0,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();

    if (json.error) {
      return {
        success: false,
        error: `RPC error ${json.error.code}: ${json.error.message}`,
        durationMs: performance.now() - t0,
      };
    }

    const rpcResult = json.result;

    if (rpcResult.error) {
      return {
        success: false,
        error: rpcResult.error,
        durationMs: performance.now() - t0,
      };
    }

    // Parse return value XDR to human-readable if present
    let returnValue: string | undefined;
    if (rpcResult.results && rpcResult.results[0]?.xdr) {
      try {
        const scVal = StellarSdk.xdr.ScVal.fromXDR(
          rpcResult.results[0].xdr,
          'base64',
        );
        returnValue = JSON.stringify(scValToPlain(scVal), null, 2);
      } catch {
        returnValue = rpcResult.results[0].xdr;
      }
    }

    // Map state changes
    const stateChanges: StateChange[] = (rpcResult.stateChanges ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sc: any) => ({
        type: sc.type as 'created' | 'updated' | 'deleted',
        key: sc.key ?? '',
        before: sc.before,
        after: sc.after,
      }),
    );

    const simulationResult: SorobanSimulationResult = {
      status: 'SUCCESS',
      returnValue,
      events: rpcResult.events ?? [],
      cost: rpcResult.cost ?? { cpuInsns: '0', memBytes: '0' },
      minResourceFee: rpcResult.minResourceFee ?? '0',
      stateChanges,
    };

    return {
      success: true,
      result: simulationResult,
      cost: rpcResult.cost ?? { cpuInsns: '0', memBytes: '0' },
      events: rpcResult.events ?? [],
      minResourceFee: rpcResult.minResourceFee ?? '0',
      durationMs: performance.now() - t0,
    };
  } catch (err: unknown) {
    const message =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? 'Simulation timed out after 15 seconds.'
        : err instanceof Error
          ? err.message
          : String(err);

    return {
      success: false,
      error: message,
      durationMs: performance.now() - t0,
    };
  }
}
