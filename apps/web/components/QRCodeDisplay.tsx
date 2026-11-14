'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  url: string;
  size?: number;
  className?: string;
  showUrlText?: boolean;
  testId?: string;
}

/**
 * WOW-F15: Real, scannable QR code generator for stage and verify screens.
 * Uses `qrcode` library to produce true high-contrast ISO-compliant QR matrices.
 * Includes fallback URL display and plain text for mobile audience participation.
 */
export default function QRCodeDisplay({
  url,
  size = 180,
  className = '',
  showUrlText = true,
  testId = 'scannable-qr-code',
}: QRCodeDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setDataUrl('');
      return;
    }

    QRCode.toDataURL(url, {
      width: size * 2, // 2x density for crisp scanning on retina/projectors
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((qr) => {
        if (!cancelled) {
          setDataUrl(qr);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to generate QR code:', err);
          setError('Không thể tạo mã QR');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-center text-center ${className}`}
    >
      <div className="bg-card p-3 rounded-card inline-block border border-rule">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={`QR Code for ${url}`}
            width={size}
            height={size}
            className="block rounded-data"
            style={{ width: `${size}px`, height: `${size}px` }}
          />
        ) : (
          <div
            style={{ width: `${size}px`, height: `${size}px` }}
            className="flex items-center justify-center bg-mist text-ink-2 text-xs font-mono rounded-data animate-pulse"
          >
            {error || 'Đang tạo QR...'}
          </div>
        )}
      </div>

      {showUrlText && url && (
        <p className="mt-3 text-xs font-mono text-ink break-all select-all bg-paper px-3 py-1.5 rounded-data border border-rule max-w-full">
          {url}
        </p>
      )}
    </div>
  );
}
