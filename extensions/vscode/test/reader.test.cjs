const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: flush } = require('node:timers/promises');
const { VisibleReader } = require('../out/reader');

test('only visible foreground activity reads; resume rechecks once and late hidden replies are discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reads = [], accepted = [];
  let disposed = 0, reply;
  const reader = new VisibleReader({ create: () => ({
    read: async (opening, since) => {
      reads.push({ opening, since });
      if (reads.length === 3) return new Promise(resolve => { reply = resolve; });
      return { revision: 'v1', nodes: [] };
    }, dispose: () => { disposed++; },
  }), accept: value => accepted.push(value), error: assert.fail });
  t.after(() => reader.dispose());
  t.mock.timers.tick(120000); await flush(); assert.equal(reads.length, 0);
  reader.setActive(true); await flush(); assert.deepEqual(reads, [{ opening: true, since: undefined }]);
  t.mock.timers.tick(30000); await flush(); assert.deepEqual(reads[1], { opening: false, since: 'v1' });
  reader.setActive(false);
  t.mock.timers.tick(120000); await flush(); assert.equal(reads.length, 2); assert.equal(disposed, 1);
  reader.setActive(true); await flush(); assert.deepEqual(reads[2], { opening: true, since: undefined });
  reader.setActive(false); reply({ revision: 'stale', nodes: [] }); await flush();
  assert.equal(accepted.length, 2);
  t.mock.timers.tick(120000); await flush(); assert.equal(reads.length, 3);
});

test('a failed local reader is replaced on the next explicit refresh', async t => {
  let created = 0, errors = 0, accepted = 0;
  const reader = new VisibleReader({ create: () => {
    const instance = ++created;
    return { read: async () => { if (instance === 1) throw new Error('Temporary database failure'); return { revision: 'ok', nodes: [] }; }, dispose() {} };
  }, accept: () => accepted++, error: () => errors++ });
  t.after(() => reader.dispose());
  reader.setActive(true); await flush();
  await reader.refresh();
  assert.equal(created, 2); assert.equal(errors, 1); assert.equal(accepted, 1);
});
