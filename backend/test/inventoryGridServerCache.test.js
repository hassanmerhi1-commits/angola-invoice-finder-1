const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const cachePath = path.resolve(__dirname, '../src/lib/inventoryGridServerCache');

function freshCache() {
  delete require.cache[require.resolve(cachePath)];
  return require(cachePath);
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('inventory grid server cache', () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  it('shares one in-flight load between concurrent callers', async () => {
    let calls = 0;
    const gate = deferred();
    const loader = async () => {
      calls += 1;
      await gate.promise;
      return { rows: [{ id: 'a' }] };
    };
    const a = cache.loadInventoryGridRowsShared('wh-1', false, loader);
    const b = cache.loadInventoryGridRowsShared('wh-1', false, loader, { skipCache: true });
    gate.resolve();
    assert.deepEqual(await a, [{ id: 'a' }]);
    assert.equal(await b, await a);
    assert.equal(calls, 1);
    await cache.loadInventoryGridRowsShared('wh-1', false, loader);
    assert.equal(calls, 1, 'second open is served from cache');
  });

  it('caches HQ too and only drops the written warehouse + HQ on a scoped invalidation', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { rows: [{ n: calls }] };
    };
    await cache.loadInventoryGridRowsShared(null, true, loader);
    await cache.loadInventoryGridRowsShared('wh-1', false, loader);
    await cache.loadInventoryGridRowsShared('wh-2', false, loader);
    assert.equal(calls, 3);

    cache.invalidateInventoryGridResultCache(['wh-1']);
    assert.equal(cache.readInventoryGridResultCache('wh-2', false)?.[0]?.n, 3);
    assert.equal(cache.readInventoryGridResultCache('wh-1', false), null);
    assert.equal(cache.readInventoryGridResultCache(null, true), null);
  });

  it('does not cache rows from a load that started before an invalidation', async () => {
    const gate = deferred();
    const slow = cache.loadInventoryGridRowsShared('wh-1', false, async () => {
      await gate.promise;
      return { rows: [{ stale: true }] };
    });
    cache.invalidateInventoryGridResultCache(['wh-1']);
    gate.resolve();
    await slow;
    assert.equal(cache.readInventoryGridResultCache('wh-1', false), null);
  });

  it('never caches degraded fallback rows', async () => {
    await cache.loadInventoryGridRowsShared('wh-1', false, async () => ({ rows: [{ stock: 0 }], cacheable: false }));
    assert.equal(cache.readInventoryGridResultCache('wh-1', false), null);
  });

  it('matches dashless warehouse ids to the same scope', async () => {
    await cache.loadInventoryGridRowsShared('ab-cd', false, async () => ({ rows: [1] }));
    cache.invalidateInventoryGridResultCache(['abcd']);
    assert.equal(cache.readInventoryGridResultCache('ab-cd', false), null);
  });
});
