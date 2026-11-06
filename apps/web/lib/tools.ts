import {
  SEARCH_PRICE,
  SUMMARY_PRICE,
  TALKMETER_PRICE_PER_MINUTE,
  TALKMETER_SESSION_CAP,
  SEARCH_QUERY_MAX_CHARS,
  SUMMARY_INPUT_MAX_CHARS,
  SUMMARY_OUTPUT_MAX_CHARS,
  SEARCH_PER_CALL_CAP,
  SUMMARY_PER_CALL_CAP,
  USDC_ADDRESS,
  CHAIN_ID,
  X402_VERSION,
  X402_SCHEME,
} from './constants';
import { hashUtf8, normalizeAddress } from './chain';

export interface ToolDefinition {
  id: string;
  priceAtomic: bigint;
  perCallCap: bigint;
  description: string;
  validateInput: (args: any) => { valid: boolean; error?: string; canonicalInput: any };
  execute: (args: any) => Promise<any>;
}

export const toolCatalog: Record<string, ToolDefinition> = {
  'tool:search': {
    id: 'tool:search',
    priceAtomic: SEARCH_PRICE,
    perCallCap: SEARCH_PER_CALL_CAP,
    description: 'Web search returning up to 3 points and source URLs',
    validateInput: (args: any) => {
      if (!args || typeof args !== 'object') {
        return { valid: false, error: 'Arguments must be an object', canonicalInput: null };
      }
      if (typeof args.query !== 'string') {
        return { valid: false, error: 'query must be a string', canonicalInput: null };
      }
      if (args.query.length === 0 || args.query.length > SEARCH_QUERY_MAX_CHARS) {
        return {
          valid: false,
          error: `query length must be between 1 and ${SEARCH_QUERY_MAX_CHARS} characters`,
          canonicalInput: null,
        };
      }
      // Fixed canonical key order
      const canonicalInput = { query: args.query };
      return { valid: true, canonicalInput };
    },
    execute: async (args: { query: string }) => {
      // Deterministic fixture tool response labelled explicitly (Finding F18)
      return {
        provider: 'deterministic-fixture',
        fixture: true,
        query: args.query,
        points: [
          `Avalanche consensus provides sub-second finality and high throughput for: ${args.query}`,
          `EIP-3009 transferWithAuthorization enables gasless meta-transactions for USDC`,
          `Guarded treasury models separate autonomous agent spend from human-supervised disbursements`,
        ],
        sources: [
          'https://docs.avax.network/learn/avalanche-consensus',
          'https://github.com/circlefin/stablecoin-evm',
          'https://testnet.snowtrace.io',
        ],
      };
    },
  },

  'tool:summary': {
    id: 'tool:summary',
    priceAtomic: SUMMARY_PRICE,
    perCallCap: SUMMARY_PER_CALL_CAP,
    description: 'Document summary up to 500 characters',
    validateInput: (args: any) => {
      if (!args || typeof args !== 'object') {
        return { valid: false, error: 'Arguments must be an object', canonicalInput: null };
      }
      if (typeof args.text !== 'string') {
        return { valid: false, error: 'text must be a string', canonicalInput: null };
      }
      if (args.text.length === 0 || args.text.length > SUMMARY_INPUT_MAX_CHARS) {
        return {
          valid: false,
          error: `text length must be between 1 and ${SUMMARY_INPUT_MAX_CHARS} characters`,
          canonicalInput: null,
        };
      }
      const canonicalInput = { text: args.text };
      return { valid: true, canonicalInput };
    },
    execute: async (args: { text: string }) => {
      // Deterministic fixture summary output labelled explicitly (Finding F18)
      const clean = args.text.replace(/\s+/g, ' ').trim();
      let summary = `Summary of document: ${clean}`;
      if (summary.length > SUMMARY_OUTPUT_MAX_CHARS) {
        summary = summary.substring(0, SUMMARY_OUTPUT_MAX_CHARS - 3) + '...';
      }
      return {
        provider: 'deterministic-fixture',
        fixture: true,
        summary,
        inputLength: args.text.length,
        summaryLength: summary.length,
      };
    },
  },

  'tool:talkmeter': {
    id: 'tool:talkmeter',
    priceAtomic: TALKMETER_PRICE_PER_MINUTE,
    perCallCap: TALKMETER_PRICE_PER_MINUTE,
    description: 'Simulated meeting minute billing (0.05 USDC / min)',
    validateInput: (args: any) => {
      if (!args || typeof args !== 'object') {
        return { valid: false, error: 'Arguments must be an object', canonicalInput: null };
      }
      if (typeof args.minuteIndex !== 'number' || args.minuteIndex < 0 || !Number.isInteger(args.minuteIndex)) {
        return { valid: false, error: 'minuteIndex must be a non-negative integer', canonicalInput: null };
      }
      const canonicalInput = { minuteIndex: args.minuteIndex };
      return { valid: true, canonicalInput };
    },
    execute: async (args: { minuteIndex: number }) => {
      return {
        minuteIndex: args.minuteIndex,
        billedAmount: Number(TALKMETER_PRICE_PER_MINUTE),
        status: 'completed',
        transcriptChunk: `Simulated meeting audio chunk transcript for minute ${args.minuteIndex}.`,
      };
    },
  },
};

export function getCanonicalPaymentTerms(params: {
  toolId: string;
  priceAtomic: bigint;
  sellerAddress: string;
  appOrigin: string;
  policyVersion: number;
}) {
  return {
    protocolVersion: X402_VERSION,
    scheme: X402_SCHEME,
    chainId: CHAIN_ID,
    asset: normalizeAddress(USDC_ADDRESS),
    priceAtomic: params.priceAtomic.toString(),
    payTo: normalizeAddress(params.sellerAddress),
    resource: `${params.appOrigin}/api/tools/${params.toolId}`,
    timeoutSeconds: 60,
    policyVersion: params.policyVersion,
  };
}
