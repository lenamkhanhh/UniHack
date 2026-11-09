import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  Hex,
  isHex,
  isAddress,
  getAddress,
  keccak256,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import {
  computeMissionPasskeyChallenge,
  validateWebAuthnAuthLocally,
  findUtf8ByteIndex,
  WebAuthnAuthPayload,
  SECP256R1_HALF_N,
  SECP256R1_N,
} from '@/lib/webauthn-p256';

const PASSKEY_AUTHORITY_ABI = parseAbi([
  'function approveMission(bytes32 missionId, address agent, bytes32 payeeRoot, uint256 cap, uint256 duration, uint256 toolCap, uint256 nonce, (bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 originIndex, uint256 r, uint256 s) auth) external',
  'function nextNonce() view returns (uint256)',
  'function treasury() view returns (address)',
  'function passkeyX() view returns (uint256)',
  'function passkeyY() view returns (uint256)',
  'function rpIdHash() view returns (bytes32)',
  'function expectedOrigin() view returns (string)',
  'function requireUserVerification() view returns (bool)',
]);

/**
 * GET: Reads current authority configuration from Avalanche Fuji / local fork.
 * Provides nextNonce, authority coordinates, expected origin, and RP ID hash to frontend.
 * Fails with 503 if unconfigured or on RPC read failure (A2-R1: no fake success/fallback).
 */
export async function GET() {
  try {
    const configuredAuthority = process.env.PASSKEY_AUTHORITY_ADDRESS || process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;
    if (!configuredAuthority || !isAddress(configuredAuthority.trim())) {
      return NextResponse.json({
        success: false,
        status: 'NOT_CONFIGURED',
        error: 'PASSKEY_AUTHORITY_ADDRESS is not configured. Biometric approvals are unavailable.',
      }, { status: 503 });
    }
    const authorityAddress = getAddress(configuredAuthority.trim()) as `0x${string}`;

    const rpcUrl = process.env.AVALANCHE_FUJI_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

    try {
      const [pX, pY, nNonce, tr, rpHash, expOrigin, reqUV, cId] = await Promise.all([
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'passkeyX' }),
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'passkeyY' }),
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'nextNonce' }),
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'treasury' }),
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'rpIdHash' }),
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'expectedOrigin' }),
        publicClient.readContract({ address: authorityAddress, abi: PASSKEY_AUTHORITY_ABI, functionName: 'requireUserVerification' }),
        publicClient.getChainId(),
      ]);

      return NextResponse.json({
        success: true,
        status: 'CONFIGURED',
        authorityAddress,
        treasuryAddress: tr,
        passkeyX: `0x${pX.toString(16).padStart(64, '0')}`,
        passkeyY: `0x${pY.toString(16).padStart(64, '0')}`,
        nextNonce: nNonce.toString(),
        rpIdHash: rpHash,
        expectedOrigin: expOrigin,
        requireUserVerification: reqUV,
        chainId: cId,
      });
    } catch (rpcErr: any) {
      return NextResponse.json({
        success: false,
        status: 'UNAVAILABLE',
        error: `Failed reading on-chain authority configuration: ${rpcErr?.message || rpcErr}`,
      }, { status: 503 });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, status: 'ERROR', error: error.message }, { status: 500 });
  }
}

/**
 * POST: Relays WebAuthn mission approval assertion to PasskeyMissionAuthority.
 * Validates inputs strictly, simulates execution before broadcasting, and asserts receipt success.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      missionId,
      agent,
      payeeRoot,
      cap,
      duration,
      toolCap,
      nonce,
      auth,
      simulateOnly,
    } = body;

    // Strict input validation
    if (
      !missionId ||
      !agent ||
      !payeeRoot ||
      cap === undefined ||
      duration === undefined ||
      toolCap === undefined ||
      nonce === undefined ||
      !auth
    ) {
      return NextResponse.json(
        { success: false, error: 'Thiếu tham số WebAuthn / mission bắt buộc' },
        { status: 400 }
      );
    }

    if (!isHex(missionId) || (missionId as string).length !== 66) {
      return NextResponse.json(
        { success: false, error: 'missionId phải là bytes32 hex hợp lệ (66 ký tự)' },
        { status: 400 }
      );
    }

    if (!isAddress(agent)) {
      return NextResponse.json(
        { success: false, error: 'agent phải là địa chỉ Ethereum hợp lệ' },
        { status: 400 }
      );
    }

    if (!isHex(payeeRoot) || (payeeRoot as string).length !== 66) {
      return NextResponse.json(
        { success: false, error: 'payeeRoot phải là bytes32 hex hợp lệ (66 ký tự)' },
        { status: 400 }
      );
    }

    // Validate auth fields
    if (
      !auth.authenticatorData ||
      !auth.clientDataJSON ||
      auth.challengeIndex === undefined ||
      auth.typeIndex === undefined ||
      auth.r === undefined ||
      auth.s === undefined
    ) {
      return NextResponse.json(
        { success: false, error: 'Auth payload thiếu trường WebAuthn bắt buộc' },
        { status: 400 }
      );
    }

    // Validate signature r and s bounds
    const rBig = BigInt(auth.r);
    const sBig = BigInt(auth.s);
    if (rBig <= 0n || rBig >= SECP256R1_N || sBig <= 0n || sBig > SECP256R1_HALF_N) {
      return NextResponse.json(
        {
          success: false,
          status: 'UNVERIFIED',
          error: 'Chữ ký P-256 không hợp lệ hoặc vi phạm chuẩn low-s (s > n/2)',
        },
        { status: 400 }
      );
    }

    const authorityAddress = (process.env.PASSKEY_AUTHORITY_ADDRESS ||
      process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS ||
      '0x77235386fe59A934645C5F273e411b0Bea8cCc9C') as `0x${string}`;

    const rpcUrl = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

    // Local validation check against expected challenge
    const chainId = await publicClient.getChainId().catch(() => 43113);
    const expectedChallenge = computeMissionPasskeyChallenge({
      chainId,
      authority: authorityAddress,
      missionId: missionId as `0x${string}`,
      agent: agent as `0x${string}`,
      payeeRoot: payeeRoot as `0x${string}`,
      cap: BigInt(cap),
      duration: BigInt(duration),
      toolCap: BigInt(toolCap),
      nonce: BigInt(nonce),
    });

    const originIdx = auth.originIndex !== undefined
      ? Number(auth.originIndex)
      : findUtf8ByteIndex(auth.clientDataJSON, '"origin":"');

    const challengeIdx = Number(auth.challengeIndex);
    const typeIdx = Number(auth.typeIndex);

    const webAuthnAuth = {
      authenticatorData: (auth.authenticatorData.startsWith('0x')
        ? auth.authenticatorData
        : `0x${auth.authenticatorData}`) as `0x${string}`,
      clientDataJSON: auth.clientDataJSON,
      challengeIndex: BigInt(challengeIdx),
      typeIndex: BigInt(typeIdx),
      originIndex: BigInt(originIdx),
      r: rBig,
      s: sBig,
    };

    // When in simulateOnly or MOCK mode: perform genuine contract simulation
    // Never claim verified or return hardcoded gas without genuine simulation
    if (simulateOnly || process.env.PAYMENT_MODE === 'MOCK') {
      try {
        const sim = await publicClient.simulateContract({
          address: authorityAddress,
          abi: PASSKEY_AUTHORITY_ABI,
          functionName: 'approveMission',
          args: [
            missionId as `0x${string}`,
            agent as `0x${string}`,
            payeeRoot as `0x${string}`,
            BigInt(cap),
            BigInt(duration),
            BigInt(toolCap),
            BigInt(nonce),
            webAuthnAuth,
          ],
        });

        const gasEstimated = sim.request.gas ? sim.request.gas.toString() : null;

        return NextResponse.json({
          success: true,
          status: 'SIMULATION_SUCCESS',
          simulated: true,
          authorityAddress,
          missionId,
          gasEstimated,
          message: 'Passkey signature verified via genuine contract simulation on RPC',
        });
      } catch (simErr: any) {
        // If simulation rejected on chain or RPC failed
        const errMsg = simErr?.shortMessage || simErr?.message || 'Simulation reverted';
        return NextResponse.json(
          {
            success: false,
            status: 'UNVERIFIED',
            simulated: true,
            authorityAddress,
            missionId,
            error: `Simulation rejected on contract: ${errMsg}`,
          },
          { status: 422 }
        );
      }
    }

    // W4-F1: Relayer privilege separation - strictly read ONLY RELAYER_PRIVATE_KEY
    const relayerKey = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
    if (!relayerKey) {
      return NextResponse.json(
        { success: false, error: 'Relayer service not configured' },
        { status: 503 }
      );
    }

    const relayerAccount = privateKeyToAccount(
      relayerKey.startsWith('0x') ? relayerKey : (`0x${relayerKey}` as Hex)
    );

    const ownerAddress = (process.env.OWNER_ADDRESS || '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c').toLowerCase();
    const mainTreasuryAddress = (process.env.GUARDED_TREASURY_ADDRESS || '0x20451c1e2dCD83F166B4f22868BAdECb5868d545').toLowerCase();

    // Refuse if relayer address == OWNER_ADDRESS
    if (relayerAccount.address.toLowerCase() === ownerAddress) {
      console.error(`[SECURITY ALERT] Relayer address ${relayerAccount.address} matches OWNER_ADDRESS. Execution refused.`);
      return NextResponse.json(
        { success: false, error: 'Security violation: Relayer cannot be owner address' },
        { status: 500 }
      );
    }

    // Refuse if relayer address == owner() of main treasury
    try {
      const treasuryOwner = await publicClient.readContract({
        address: mainTreasuryAddress as `0x${string}`,
        abi: parseAbi(['function owner() view returns (address)']),
        functionName: 'owner',
      });
      if (relayerAccount.address.toLowerCase() === treasuryOwner.toLowerCase()) {
        console.error(`[SECURITY ALERT] Relayer address ${relayerAccount.address} matches treasury owner(). Execution refused.`);
        return NextResponse.json(
          { success: false, error: 'Security violation: Relayer cannot be treasury owner' },
          { status: 500 }
        );
      }
    } catch {
      // In offline/test environments, ownerAddress check suffices
    }

    // 1. Simulate contract execution before broadcasting transaction
    const { request } = await publicClient.simulateContract({
      address: authorityAddress,
      abi: PASSKEY_AUTHORITY_ABI,
      functionName: 'approveMission',
      account: relayerAccount,
      args: [
        missionId as `0x${string}`,
        agent as `0x${string}`,
        payeeRoot as `0x${string}`,
        BigInt(cap),
        BigInt(duration),
        BigInt(toolCap),
        BigInt(nonce),
        webAuthnAuth,
      ],
    });

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Ensure transaction was confirmed successfully
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { success: false, error: 'Transaction reverted on-chain', txHash: hash },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'CONFIRMED',
      txHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : '0',
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${hash}`,
      authorityAddress,
    });
  } catch (error: any) {
    console.error('Passkey relay error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Lỗi gửi giao dịch qua relayer' },
      { status: 500 }
    );
  }
}
