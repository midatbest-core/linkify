import { QRCodeSVG } from 'qrcode.react';
import { useRef } from 'react';
import { downloadSvgAsPng } from '../utils/qrDownload.js';

export default function QrCode({ value, name = 'linkify-qr' }) {
  const container = useRef(null);
  function download() {
    const svg = container.current?.querySelector('svg');
    if (!svg) return;
    downloadSvgAsPng(svg, name);
  }

  return <div ref={container} className="flex flex-col items-center gap-3 rounded-xl bg-white p-3">
    <QRCodeSVG value={value} size={180} level="H" includeMargin role="img" aria-label={`QR code for ${value}`} title={`QR code for ${value}`} />
    <button type="button" onClick={download} className="text-sm font-semibold text-[#295f22] underline underline-offset-4">Download QR as PNG</button>
  </div>;
}
