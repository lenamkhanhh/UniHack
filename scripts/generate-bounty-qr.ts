import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';

async function main() {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3100';
  const targetUrl = `${publicBaseUrl.replace(/\/$/, '')}/bounty`;

  const outputPath = path.resolve(__dirname, '../artifacts/submission-s1/bounty-qr.png');
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await QRCode.toFile(outputPath, targetUrl, {
    width: 600,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });

  console.log(`[Bounty QR] Generated QR code pointing to ${targetUrl} at ${outputPath}`);
}

main().catch(console.error);
