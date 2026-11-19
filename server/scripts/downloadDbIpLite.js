import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

// Update the release and this official MMDB checksum together when refreshing DB-IP.
const RELEASE = '2026-11';
const ARCHIVE_SHA1 = '21ed2ad1b50b98918c2432b61421dce9e61ed121';
const MMDB_SHA1 = 'a6f14e8da5565c713cdda9f1959a904b2eb88337';
const DOWNLOAD_URL = `https://download.db-ip.com/free/dbip-city-lite-${RELEASE}.mmdb.gz`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputPath = resolve(repoRoot, 'server/data/dbip-city-lite.mmdb');
const temporaryGzip = resolve(tmpdir(), `dbip-city-lite-${randomUUID()}.mmdb.gz`);
const temporaryMmdb = resolve(dirname(outputPath), `.dbip-city-lite-${randomUUID()}.mmdb`);

function hashingTransform(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

try {
  const response = await fetch(DOWNLOAD_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`DB-IP download failed (HTTP ${response.status}).`);
  await mkdir(dirname(outputPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryGzip, { flags: 'wx' }));

  const archiveHash = createHash('sha1');
  for await (const chunk of createReadStream(temporaryGzip)) archiveHash.update(chunk);
  if (archiveHash.digest('hex') !== ARCHIVE_SHA1) throw new Error(`DB-IP ${RELEASE} archive checksum mismatch.`);

  const hash = createHash('sha1');
  await pipeline(createReadStream(temporaryGzip), createGunzip(), hashingTransform(hash), createWriteStream(temporaryMmdb, { flags: 'wx' }));
  // DB-IP publishes checksums for the uncompressed MMDB, not the .gz transport archive.
  if (hash.digest('hex') !== MMDB_SHA1) throw new Error(`DB-IP ${RELEASE} MMDB checksum mismatch.`);

  const maxmind = await import('maxmind');
  const reader = await maxmind.open(temporaryMmdb);
  const sample = reader.get('8.8.8.8');
  if (!sample?.country?.iso_code || !sample?.country?.names?.en) throw new Error('Downloaded DB-IP MMDB failed reader validation.');
  await rename(temporaryMmdb, outputPath);
  console.info(`Prepared DB-IP City Lite ${RELEASE} at server/data/dbip-city-lite.mmdb.`);
} catch (error) {
  console.error(`Unable to prepare DB-IP City Lite (${error.name ?? 'Error'}: ${error.message ?? 'unknown failure'}).`);
  process.exitCode = 1;
} finally {
  await Promise.all([
    rm(temporaryGzip, { force: true }),
    rm(temporaryMmdb, { force: true }),
  ]);
}
