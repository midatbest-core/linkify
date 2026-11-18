import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { downloadSvgAsPng } from '../src/utils/qrDownload.js';

test('renders an SVG QR code for the complete short URL', () => {
  const shortUrl = 'https://short.example/Custom-Alias';
  const markup = renderToStaticMarkup(React.createElement(QRCodeSVG, { value: shortUrl, size: 180, level: 'H', includeMargin: true }));
  assert.match(markup, /<svg/);
  assert.match(markup, /<path/);
  assert.match(markup, /viewBox="0 0 41 41"/);
  const randomCodeMarkup = renderToStaticMarkup(React.createElement(QRCodeSVG, { value: 'https://short.example/aBc1234', size: 180, level: 'H', includeMargin: true }));
  assert.notEqual(markup, randomCodeMarkup);
});

test('exports a 1024px PNG with a link-specific filename', () => {
  const created = [];
  const revoked = [];
  const operations = [];
  const browser = {
    XMLSerializer: class { serializeToString(svg) { return `<svg>${svg.value}</svg>`; } },
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    URL: { createObjectURL(blob) { const value = `blob:${created.length}`; created.push({ value, blob }); return value; }, revokeObjectURL(value) { revoked.push(value); } },
    Image: class { set src(value) { this.source = value; this.onload(); } },
    document: { createElement(tag) {
      if (tag === 'canvas') return { getContext: () => ({ fillRect: (...args) => operations.push(['fillRect', ...args]), drawImage: (...args) => operations.push(['drawImage', ...args]) }), toBlob(callback, type) { operations.push(['toBlob', type]); callback({ type }); } };
      return { click() { operations.push(['click', this.download, this.href]); }, set href(value) { this.hrefValue = value; }, get href() { return this.hrefValue; } };
    } },
  };
  downloadSvgAsPng({ value: 'https://short.example/aBc1234' }, 'linkify-aBc1234', browser);
  assert.equal(operations.find(([name]) => name === 'drawImage')[4], 1024);
  assert.deepEqual(operations.find(([name]) => name === 'toBlob'), ['toBlob', 'image/png']);
  assert.deepEqual(operations.find(([name]) => name === 'click'), ['click', 'linkify-aBc1234.png', 'blob:1']);
  assert.deepEqual(revoked, ['blob:0', 'blob:1']);
});
