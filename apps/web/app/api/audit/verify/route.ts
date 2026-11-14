import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyAuditChain } from '@/lib/audit';

export async function GET() {
  try {
    const entries = await prisma.auditEntry.findMany({
      orderBy: { id: 'asc' },
    });
    const head = await prisma.auditHead.findUnique({ where: { id: 1 } });

    const result = verifyAuditChain(entries, head?.lastHash);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entries = Array.isArray(body)
      ? body
      : body.audit?.entries || body.entries || [];
    const checkpoint = body.audit?.checkpoint || body.checkpoint;
    const expectedHeadHash = checkpoint?.headHash || body.expectedHeadHash;

    const result = verifyAuditChain(entries, expectedHeadHash, checkpoint);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
