import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';

console.log('[test-runner] Starting MongoMemoryReplSet...');
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const uri = replSet.getUri();
console.log('[test-runner] Replica set running at:', uri);

const child = spawn(
  process.execPath,
  ['--test', 'server/test/*.mongo.test.js'],
  {
    env: { ...process.env, MONGODB_TEST_URI: uri },
    stdio: 'inherit',
    shell: false,
  },
);

child.on('exit', async (code) => {
  console.log('[test-runner] Tests finished with exit code:', code);
  await replSet.stop();
  process.exit(code ?? 0);
});
