import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const evidencePath = path.resolve(process.cwd(), '../../evidence/twin/twin.json');
    const localEvidencePath = path.resolve(process.cwd(), 'evidence/twin/twin.json');

    const targetPath = fs.existsSync(evidencePath)
      ? evidencePath
      : fs.existsSync(localEvidencePath)
      ? localEvidencePath
      : null;

    if (!targetPath) {
      return NextResponse.json({
        exists: false,
        status: 'NOT_RUN',
        message:
          'No live on-chain evidence recorded yet. Broadcast is pending owner approval (TWIN_ALLOW_BROADCAST=1).',
      });
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    const data = JSON.parse(content);

    return NextResponse.json({
      exists: true,
      status: 'RECORDED',
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { exists: false, status: 'ERROR', error: err.message },
      { status: 500 }
    );
  }
}
