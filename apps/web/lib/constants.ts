// Constants from docs/design/pipeline/00-overview.md §6 - NEVER modify without updating specs and manifest

export const CHAIN_ID = 43113;
export const CHAIN_NAME = 'Avalanche Fuji';
export const RPC_URL = 'https://api.avax-test.network/ext/bc/C/rpc';
export const EXPLORER_URL = 'https://testnet.snowtrace.io';

export const USDC_ADDRESS = '0x5425890298aed601595a70ab815c96711a31bc65';
export const USDC_DECIMALS = 6;
export const USDC_NAME = 'USD Coin';
export const USDC_VERSION = '2';

// Registry candidates (00 §6)
export const IDENTITY_REGISTRY = '0x8004a818bfb912233c491871b3d84c89a494bd9e';
export const REPUTATION_REGISTRY = '0x8004b663056a597dffe9eccc1965a193b7388713';

// Caps in atomic units (BigInt)
export const PER_TX_TREASURY_CAP = 5_000_000n; // 5 USDC
export const UTC_DAILY_TREASURY_CAP = 20_000_000n; // 20 USDC
export const MISSION_TREASURY_CAP_DEFAULT = 10_000_000n; // 10 USDC
export const MISSION_TOOL_CAP_DEFAULT = 5_000_000n; // 5 USDC
export const TALKMETER_SESSION_CAP = 2_000_000n; // 2 USDC

// Tool prices in atomic units (BigInt)
export const SEARCH_PRICE = 100_000n; // 0.10 USDC
export const SUMMARY_PRICE = 500_000n; // 0.50 USDC
export const TALKMETER_PRICE_PER_MINUTE = 50_000n; // 0.05 USDC / min

// Tool Caps per-call
export const SEARCH_PER_CALL_CAP = 100_000n;
export const SUMMARY_PER_CALL_CAP = 500_000n;

// Durations & TTLs in seconds
export const MISSION_DURATION_SECONDS = 24 * 3600; // 24 hours
export const QUEUE_TTL_SECONDS = 48 * 3600; // 48 hours
export const QUOTE_TTL_SECONDS = 60; // 60 seconds
export const RESERVATION_TTL_SECONDS = 60; // 60 seconds
export const AUTHORIZATION_TTL_SECONDS = 60; // <= 60 seconds
export const AUTH_CHALLENGE_TTL_SECONDS = 600; // 600 seconds (10 min)
export const OWNER_READ_TOKEN_TTL_SECONDS = 900; // 900 seconds (15 min)

// Rate limiting / velocity
export const VELOCITY_MAX_CALLS_PER_MINUTE = 10;

// Upstream limits
export const SEARCH_QUERY_MAX_CHARS = 500;
export const SUMMARY_INPUT_MAX_CHARS = 2000;
export const SUMMARY_OUTPUT_MAX_CHARS = 500;

// x402 Protocol (v1 & v2 migration support per PLAN_MAX §M6)
export const DEFAULT_X402_VERSION: 1 | 2 = 2;
export const getActiveX402Version = (): 1 | 2 => {
  const envVal = process.env.X402_VERSION;
  return envVal === '1' ? 1 : 2;
};
export const getX402Version = getActiveX402Version;
export const X402_SCHEME = 'exact';

// Network Identifiers (CAIP-2 for v2, legacy name for v1)
export const CAIP2_AVALANCHE_FUJI = 'eip155:43113';
export const LEGACY_AVALANCHE_FUJI = 'avalanche-fuji';

// Standard x402 v2 Header Names (docs.x402.org/guides/migration-v1-to-v2)
export const X402_V2_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const X402_V2_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const X402_V2_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

// Legacy x402 v1 Header Names
export const X402_V1_HEADER = 'X-PAYMENT';
export const X402_V1_RESPONSE_HEADER = 'X-PAYMENT-RESPONSE';

// Generic backwards-compatible aliases
export const X402_HEADER = X402_V1_HEADER;
export const X402_RESPONSE_HEADER = X402_V1_RESPONSE_HEADER;

export const FACILITATOR_DEFAULT_URL = 'https://facilitator.ultravioletadao.xyz';
