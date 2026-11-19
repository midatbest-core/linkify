import { isIP } from 'node:net';

function ipv4Octets(address) {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
}

function toIpv4Number(octets) {
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function inIpv4Range(address, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toIpv4Number(address) & mask) === (toIpv4Number(base) & mask);
}

function isPublicIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const ranges = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !ranges.some(([base, bits]) => inIpv4Range(octets, ipv4Octets(base), bits));
}

function ipv6Groups(address) {
  if (isIP(address) !== 6) return null;
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const octets = ipv4Octets(value.slice(lastColon + 1));
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(missing).fill('0'), ...right].map((group) => Number.parseInt(group || '0', 16));
}

function isPublicIpv6(address) {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  // IPv4-mapped addresses inherit their embedded IPv4 classification.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const a = groups[6] >> 8; const b = groups[6] & 255;
    const c = groups[7] >> 8; const d = groups[7] & 255;
    return isPublicIpv4(`${a}.${b}.${c}.${d}`);
  }
  const first = groups[0];
  // Global unicast space only; this excludes loopback, ULA, link-local,
  // multicast, unspecified, and other special-purpose ranges.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (groups[1] === 0x0db8 || (groups[1] >= 0 && groups[1] <= 0x01ff))) return false;
  if (first === 0x2002) return false; // deprecated 6to4
  return true;
}

export function isPublicIp(address) {
  const version = typeof address === 'string' ? isIP(address) : 0;
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}
