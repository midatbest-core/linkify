export function downloadSvgAsPng(svg, name, browser = globalThis) {
  if (!svg) return;
  const serialized = new browser.XMLSerializer().serializeToString(svg);
  const image = new browser.Image();
  const url = browser.URL.createObjectURL(new browser.Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }));
  image.onload = () => {
    const canvas = browser.document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 1024, 1024);
    context.drawImage(image, 0, 0, 1024, 1024);
    browser.URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const downloadUrl = browser.URL.createObjectURL(blob);
      const anchor = browser.document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${name}.png`;
      anchor.click();
      browser.URL.revokeObjectURL(downloadUrl);
    }, 'image/png');
  };
  image.onerror = () => browser.URL.revokeObjectURL(url);
  image.src = url;
}
