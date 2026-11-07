import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

describe('WOW-F15: Real Scannable QR Code Generation & Decoding Suite', () => {
  it('generates a real scannable QR code that jsQR decodes to exact target URL', async () => {
    const targetUrl = 'http://localhost:3100/arena';

    // 1. Generate QR Code raw matrix / raw image buffer
    const qrData = QRCode.create(targetUrl, { errorCorrectionLevel: 'M' });
    expect(qrData.modules.size).toBeGreaterThan(10);

    // 2. Render to raw RGBA pixel buffer
    const size = qrData.modules.size;
    const margin = 2;
    const fullSize = size + margin * 2;
    const rawData = new Uint8ClampedArray(fullSize * fullSize * 4);

    // Fill background white
    for (let i = 0; i < rawData.length; i += 4) {
      rawData[i] = 255;
      rawData[i + 1] = 255;
      rawData[i + 2] = 255;
      rawData[i + 3] = 255;
    }

    // Fill dark modules
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qrData.modules.get(r, c)) {
          const pixelIndex = ((r + margin) * fullSize + (c + margin)) * 4;
          rawData[pixelIndex] = 0;
          rawData[pixelIndex + 1] = 0;
          rawData[pixelIndex + 2] = 0;
          rawData[pixelIndex + 3] = 255;
        }
      }
    }

    // 3. Decode using jsQR (industry standard QR decoder)
    const code = jsQR(rawData, fullSize, fullSize);
    expect(code).not.toBeNull();
    expect(code?.data).toBe(targetUrl);
  });

  it('generates and decodes verify mission QR code containing complete path', async () => {
    const verifyUrl = 'https://missionpay.app/verify/mission_prod_8822';
    const qrData = QRCode.create(verifyUrl, { errorCorrectionLevel: 'M' });

    const size = qrData.modules.size;
    const margin = 2;
    const fullSize = size + margin * 2;
    const rawData = new Uint8ClampedArray(fullSize * fullSize * 4);

    for (let i = 0; i < rawData.length; i += 4) {
      rawData[i] = 255;
      rawData[i + 1] = 255;
      rawData[i + 2] = 255;
      rawData[i + 3] = 255;
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qrData.modules.get(r, c)) {
          const pixelIndex = ((r + margin) * fullSize + (c + margin)) * 4;
          rawData[pixelIndex] = 0;
          rawData[pixelIndex + 1] = 0;
          rawData[pixelIndex + 2] = 0;
          rawData[pixelIndex + 3] = 255;
        }
      }
    }

    const decoded = jsQR(rawData, fullSize, fullSize);
    expect(decoded).not.toBeNull();
    expect(decoded?.data).toBe(verifyUrl);
  });

  it('generates valid data URLs that start with data:image/png;base64', async () => {
    const dataUrl = await QRCode.toDataURL('http://localhost:3100/arena', {
      errorCorrectionLevel: 'M',
    });
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });
});
