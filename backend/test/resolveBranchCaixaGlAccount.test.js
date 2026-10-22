const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBranchCaixaGlAccountCode,
  requireBranchCaixaGlAccountCode,
  linkOrphanBranchCaixaAccounts,
  BRANCH_CAIXA_GL_MISSING,
} = require('../src/lib/resolveBranchCaixaGlAccount');

test('resolveBranchCaixaGlAccountCode prefers branch_id then sale journal', async (t) => {
  const queries = [];
  const client = {
    engine: 'postgres',
    query(sql, params) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' '), params });
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM branches WHERE id = $1')) {
        return { rows: [{ id: 'branch-soyo', name: 'SOYO', code: 'SOY03' }] };
      }
      if (normalized.includes('JOIN branches b ON b.id = $1') && normalized.includes('chart_of_accounts coa')) {
        return { rows: [] };
      }
      if (normalized.includes('reference_type =') && normalized.includes("'sale'")) {
        return { rows: [{ code: '458' }] };
      }
      if (normalized.includes('FROM chart_of_accounts') && normalized.includes('ILIKE')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const code = await resolveBranchCaixaGlAccountCode(client, {
    branchId: 'branch-soyo',
    branchName: 'SOYO',
    saleId: 'sale-1',
  });

  assert.equal(code, '458');
  assert.ok(queries.some((q) => q.params?.[0] === 'sale-1'));
});

test('resolveBranchCaixaGlAccountCode matches by name even when branch_id is stale', async () => {
  const client = {
    engine: 'postgres',
    query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM branches WHERE id = $1')) {
        return { rows: [{ id: 'branch-soyo', name: 'SOYO', code: 'SOY03' }] };
      }
      if (normalized.includes('JOIN branches b ON b.id = $1') && normalized.includes('chart_of_accounts coa')) {
        return { rows: [{ code: '458' }] };
      }
      if (normalized.includes('reference_type =') && normalized.includes("'sale'")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const code = await resolveBranchCaixaGlAccountCode(client, {
    branchId: 'branch-soyo',
    saleId: '',
  });

  assert.equal(code, '458');
});

test('resolveBranchCaixaGlAccountCode returns null when nothing matches', async () => {
  const client = {
    engine: 'postgres',
    query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ');
      if (normalized.includes('FROM branches WHERE id = $1')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const code = await resolveBranchCaixaGlAccountCode(client, {
    branchId: 'missing',
    branchName: '',
    saleId: '',
  });

  assert.equal(code, null);
});

test('requireBranchCaixaGlAccountCode throws a clear reason', async () => {
  const client = {
    engine: 'postgres',
    query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ');
      if (normalized.includes('FROM branches WHERE id = $1')) {
        return { rows: [{ id: 'b-soyo', name: 'SOYO 04', code: 'SY04' }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => requireBranchCaixaGlAccountCode(client, { branchId: 'b-soyo' }),
    (err) => {
      assert.equal(err.code, BRANCH_CAIXA_GL_MISSING);
      assert.match(String(err.message), /SOYO 04/);
      assert.match(String(err.message), /não tem conta de caixa \(45x\)/);
      return true;
    },
  );
});

test('resolveBranchCaixaGlAccountCode accepts 451 when it belongs to the branch', async () => {
  const client = {
    engine: 'postgres',
    query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ');
      if (normalized.includes('FROM branches WHERE id = $1')) {
        return { rows: [{ id: 'b-sede', name: 'Sede', code: 'SD' }] };
      }
      if (normalized.includes('JOIN branches b ON b.id = $1') && normalized.includes('chart_of_accounts coa')) {
        return { rows: [{ code: '451' }] };
      }
      return { rows: [] };
    },
  };

  const code = await resolveBranchCaixaGlAccountCode(client, {
    branchId: 'b-sede',
    branchName: 'Sede',
  });
  assert.equal(code, '451');
});

test('linkOrphanBranchCaixaAccounts updates matching orphan rows', async () => {
  let updated = false;
  const dbMock = {
    engine: 'postgres',
    query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ');
      if (normalized.includes('FROM chart_of_accounts coa') && normalized.includes('JOIN branches b')) {
        return {
          rows: [{
            id: 'acc-458',
            code: '458',
            current_branch_id: null,
            branch_id: 'b-soyo',
            branch_name: 'SOYO',
          }],
        };
      }
      if (normalized.includes('WHERE branch_id = $1') && normalized.includes('AND id != $2')) {
        return { rows: [] };
      }
      if (normalized.includes('UPDATE chart_of_accounts SET branch_id')) {
        updated = true;
        assert.equal(params[0], 'b-soyo');
        assert.equal(params[1], 'acc-458');
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const result = await linkOrphanBranchCaixaAccounts(dbMock);
  assert.equal(result.linked, 1);
  assert.equal(updated, true);
});
