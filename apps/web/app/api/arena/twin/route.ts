import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const liveEvidencePaths = [
      path.resolve(process.cwd(), '../../evidence/twin/twin.live.json'),
      path.resolve(process.cwd(), 'evidence/twin/twin.live.json'),
    ];
    const dryRunEvidencePaths = [
      path.resolve(process.cwd(), '../../evidence/twin/twin.dryrun.json'),
      path.resolve(process.cwd(), 'evidence/twin/twin.dryrun.json'),
    ];

    let liveData: any = null;
    for (const p of liveEvidencePaths) {
      if (fs.existsSync(p)) {
        try {
          liveData = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        } catch {}
      }
    }

    let dryRunData: any = null;
    for (const p of dryRunEvidencePaths) {
      if (fs.existsSync(p)) {
        try {
          dryRunData = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        } catch {}
      }
    }

    // Live status requires broadcast mode AND all 3 transaction hashes present
    const isLive = Boolean(
      liveData &&
        liveData.mode === 'broadcast' &&
        liveData.missionA?.txHash &&
        liveData.missionB?.negativeControl?.txHash &&
        liveData.missionB?.positiveControl?.txHash &&
        !liveData.missionA.txHash.startsWith('0x0000000000000000000000000000000000000000000000000000000000000000')
    );

    if (isLive) {
      return NextResponse.json({
        status: 'LIVE',
        isLive: true,
        data: liveData,
        dryRunData,
      });
    }

    if (dryRunData) {
      return NextResponse.json({
        status: 'SIMULATED',
        isLive: false,
        data: dryRunData,
      });
    }

    return NextResponse.json({
      status: 'NOT_RUN',
      isLive: false,
      message: 'No on-chain or simulation evidence found yet.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: 'ERROR', isLive: false, error: err.message },
      { status: 500 }
    );
  }
}
