import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

const PASSKEY_AUTHORITY_ABI = parseAbi([
  'function approveMission(bytes32 missionId, address agent, bytes32 payeeRoot, uint256 cap, uint256 duration, uint256 toolCap, uint256 nonce, (bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s) auth) external',
  'function nextNonce() view returns (uint256)',
  'function treasury() view returns (address)',
  'function passkeyX() view returns (uint256)',
  'function passkeyY() view returns (uint256)',
]);

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

    if (!missionId || !agent || !payeeRoot || cap === undefined || duration === undefined || toolCap === undefined || nonce === undefined || !auth) {
      return NextResponse.json(
        { success: false, error: 'Thiếu tham số WebAuthn / mission bắt buộc' },
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

    // In simulate or mock mode, we do not require relayer private key
    if (simulateOnly || process.env.PAYMENT_MODE === 'MOCK') {
      return NextResponse.json({
        success: true,
        mode: 'MOCK_RELAY',
        simulated: true,
        authorityAddress,
        missionId,
        gasEstimated: '281498',
        message: 'Passkey signature verified in simulation mode',
      });
    }

    const relayerKey = (process.env.DEPLOYER_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY) as Hex | undefined;
    if (!relayerKey) {
      return NextResponse.json(
        { success: false, error: 'Relayer private key not configured' },
        { status: 500 }
      );
    }

    const relayerAccount = privateKeyToAccount(
      relayerKey.startsWith('0x') ? relayerKey : (`0x${relayerKey}` as Hex)
    );

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

    const webAuthnAuth = {
      authenticatorData: (auth.authenticatorData.startsWith('0x')
        ? auth.authenticatorData
        : `0x${auth.authenticatorData}`) as `0x${string}`,
      clientDataJSON: auth.clientDataJSON,
      challengeIndex: BigInt(auth.challengeIndex),
      typeIndex: BigInt(auth.typeIndex),
      r: BigInt(auth.r),
      s: BigInt(auth.s),
    };

    const hash = await walletClient.writeContract({
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

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({
      success: true,
      txHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
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
