import { generateId } from '@/lib/utils';
/**
 * Chart of Accounts Engine
 * 
 * Automatically creates sub-accounts for suppliers/clients
 * and updates account balances when journal entries are posted.
 * 
 * Dual-mode: tries API first (for Electron/server), falls back to localStorage.
 */

import { Account } from '@/types/accounting';
import { api } from '@/lib/api/client';

const LOCAL_COA_STORAGE_KEY = 'kwanzaerp_chart_of_accounts_v2';
const LEGACY_COA_STORAGE_KEY = 'kwanzaerp_chart_of_accounts';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

// ============= LOCAL STORAGE HELPERS =============

function loadAccountsLocal(): Account[] {
  try {
    const raw =
      localStorage.getItem(LOCAL_COA_STORAGE_KEY)
      || localStorage.getItem(LEGACY_COA_STORAGE_KEY);
    const accounts: Account[] = raw ? JSON.parse(raw) : [];
    return ensureEssentialAccounts(accounts);
  } catch { return []; }
}

function saveAccountsLocal(accounts: Account[]) {
  localStorage.setItem(LOCAL_COA_STORAGE_KEY, JSON.stringify(
    [...accounts].sort((a, b) => a.code.localeCompare(b.code))
  ));
  try { localStorage.removeItem(LEGACY_COA_STORAGE_KEY); } catch { /* ignore */ }
}

// ============= API HELPERS =============

async function tryApiCreateAccount(account: Account): Promise<boolean> {
  try {
    const response = await api.chartOfAccounts.create({
      code: account.code,
      name: account.name,
      description: account.description,
      account_type: account.account_type,
      account_nature: account.account_nature,
      parent_id: account.parent_id,
      level: account.level,
      is_header: account.is_header,
      opening_balance: account.opening_balance,
      branch_id: account.branch_id,
    });
    if (response.error) {
      console.warn('[CoA Engine] API create failed:', response.error);
      return false;
    }
    console.log(`[CoA Engine] API: Created account ${account.code} — ${account.name}`);
    return true;
  } catch (e) {
    // API not available (web preview mode)
    return false;
  }
}

async function tryApiUpdateBalance(accountCode: string, balanceChange: number): Promise<boolean> {
  try {
    // Fetch the account by listing and finding by code
    const listResponse = await api.chartOfAccounts.list();
    if (listResponse.error || !listResponse.data) return false;
    
    const account = listResponse.data.find((a: any) => a.code === accountCode);
    if (!account) return false;
    
    const newBalance = (account.current_balance || 0) + balanceChange;
    const response = await api.chartOfAccounts.update(account.id, {
      current_balance: newBalance,
    });
    if (response.error) {
      console.warn('[CoA Engine] API balance update failed:', response.error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function tryLoadAccountsFromApi(): Promise<Account[] | null> {
  try {
    const response = await api.chartOfAccounts.list();
    if (response.error || !response.data) return null;
    return response.data as Account[];
  } catch {
    return null;
  }
}

// ============= ESSENTIAL ACCOUNTS =============

function ensureEssentialAccounts(accounts: Account[]): Account[] {
  const now = new Date().toISOString();
  // Angola PGC (novo com IVA) posting anchors (no-dot numbering).
  const required: Array<{ code: string; name: string; type: AccountType; nature: 'debit' | 'credit'; level: number; is_header: boolean; parent_code: string }> = [
    { code: '212', name: 'Compras - Mercadorias', type: 'asset', nature: 'debit', level: 2, is_header: false, parent_code: '21' },
    { code: '261', name: 'Mercadorias em armazém', type: 'asset', nature: 'debit', level: 2, is_header: false, parent_code: '26' },
    { code: '345', name: 'IVA', type: 'liability', nature: 'credit', level: 2, is_header: true, parent_code: '34' },
    { code: '3451', name: 'IVA dedutível', type: 'liability', nature: 'debit', level: 3, is_header: false, parent_code: '345' },
    { code: '3452', name: 'IVA liquidado', type: 'liability', nature: 'credit', level: 3, is_header: false, parent_code: '345' },
    { code: '451', name: 'Caixa', type: 'asset', nature: 'debit', level: 2, is_header: false, parent_code: '45' },
    { code: '711', name: 'Custo das mercadorias vendidas', type: 'expense', nature: 'debit', level: 2, is_header: false, parent_code: '71' },
  ];
  
  let changed = false;
  for (const req of required) {
    if (accounts.some(a => a.code === req.code)) continue;
    const parent = accounts.find(a => a.code === req.parent_code);
    accounts.push({
      id: `local-coa-${req.code.replace(/\./g, '-')}`,
      code: req.code,
      name: req.name,
      account_type: req.type,
      account_nature: req.nature,
      parent_id: parent?.id || null,
      parent_name: parent?.name || null,
      parent_code: req.parent_code,
      level: req.level,
      is_header: req.is_header,
      is_active: true,
      opening_balance: 0,
      current_balance: 0,
      branch_id: null,
      children_count: 0,
      created_at: now,
      updated_at: now,
    } as Account);
    changed = true;
  }
  
  if (changed) {
    saveAccountsLocal(accounts);
  }
  return accounts;
}

// ============= BRANCH CAIXA ACCOUNT =============

/**
 * Ensure each branch has a sub-account under 45 (Caixa).
 * Creates accounts like 454 Caixa - Sede, 455 Caixa - Luanda, etc.
 * Call this on app init / when branches are loaded.
 */
/** Returns true when at least one branch caixa account was created. */
export async function ensureBranchCaixaAccounts(
  branches: { id: string; name: string }[],
  preloaded?: Account[],
): Promise<boolean> {
  if (!branches || branches.length === 0) return false;

  let accounts: Account[] | null =
    preloaded && preloaded.length > 0 ? [...preloaded] : await tryLoadAccountsFromApi();
  const usingApi = accounts !== null;

  if (!accounts) {
    accounts = loadAccountsLocal();
  }

  const parent = accounts.find(a => a.code === '45');
  if (!parent) {
    console.warn('[CoA Engine] Parent account 45 (Caixa) not found');
    return false;
  }

  // Fast exit: every branch already has a 45x leaf — avoid create/list round-trips.
  const missing = branches.filter((branch) => !accounts!.find(a =>
    a.code.startsWith('45') &&
    a.level >= 2 &&
    !a.is_header &&
    (a.branch_id === branch.id || a.name.includes(branch.name))
  ));
  if (missing.length === 0) return false;

  let changed = false;
  const now = new Date().toISOString();

  for (const branch of missing) {

    // Find next free 45x code (451–453 reserved by PGC).
    const children = accounts.filter(
      (a) => /^45\d+$/.test(a.code) && a.code.length === 3 && a.level === 2 && !a.is_header,
    );
    const used = new Set(children.map((a) => a.code));
    let code = '';
    for (let suffix = 4; suffix <= 99; suffix += 1) {
      const candidate = `45${suffix}`;
      if (!used.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      console.warn('[CoA Engine] No free 45x caixa code for branch', branch.name);
      continue;
    }

    const newAccount: Account = {
      id: `local-coa-caixa-${branch.id}`,
      code,
      name: `Caixa - ${branch.name}`,
      description: `Conta caixa da filial ${branch.name}`,
      account_type: 'asset',
      account_nature: 'debit',
      parent_id: parent.id,
      parent_name: parent.name,
      parent_code: '45',
      level: 2,
      is_header: false,
      is_active: true,
      opening_balance: 0,
      current_balance: 0,
      branch_id: branch.id,
      children_count: 0,
      created_at: now,
      updated_at: now,
    } as Account;

    if (usingApi) {
      const ok = await tryApiCreateAccount(newAccount);
      if (ok) {
        const reloaded = await tryLoadAccountsFromApi();
        if (reloaded) accounts = reloaded;
      }
    }

    // Update parent children count
    const parentIdx = accounts.findIndex(a => a.id === parent.id);
    if (parentIdx >= 0) {
      accounts[parentIdx] = { ...accounts[parentIdx], children_count: (accounts[parentIdx].children_count || 0) + 1 };
    }
    accounts.push(newAccount);
    changed = true;
    console.log(`[CoA Engine] Created branch caixa account ${code} — Caixa - ${branch.name}`);
  }

  if (changed) {
    saveAccountsLocal(accounts);
  }
  return changed;
}

// ============= SUPPLIER ACCOUNT =============

// Supplier accounts live under the Fornecedores group (32); default parent 321.
// Auto codes are 8 digits (e.g. 32100001).
const SUPPLIER_GROUP_CODE = '32';
const DEFAULT_SUPPLIER_PARENT_CODE = '321';
const ENTITY_ACCOUNT_CODE_LENGTH = 8;

// Next free 8-digit code under a parent (parent "321" -> "32100001").
function nextEntityAccountCode(parentCode: string, accounts: Account[]): string {
  const suffixLen = ENTITY_ACCOUNT_CODE_LENGTH - parentCode.length;
  const maxSeq = accounts.reduce((max, a) => {
    const c = a.code || '';
    if (!c.startsWith(parentCode) || c.length <= parentCode.length || a.is_header) return max;
    const parsed = Number(c.slice(parentCode.length));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${parentCode}${String(maxSeq + 1).padStart(suffixLen, '0')}`;
}

function resolveSupplierParentCode(accounts: Account[], parentCode?: string): string {
  let code = (parentCode || '').trim() || DEFAULT_SUPPLIER_PARENT_CODE;
  if (!code.startsWith(SUPPLIER_GROUP_CODE)) code = DEFAULT_SUPPLIER_PARENT_CODE;
  const exists = accounts.some(a => a.code === code && a.is_active !== false);
  return exists ? code : DEFAULT_SUPPLIER_PARENT_CODE;
}

/**
 * Ensure a supplier has a sub-account under the Fornecedores group (32).
 * parentCode lets the caller choose the 32x sub-account to file under (default 321).
 * Returns an 8-digit account code (e.g., "32100001"). Tries API first, then localStorage.
 */
export async function ensureSupplierAccount(
  supplierId: string,
  supplierName: string,
  supplierNif?: string,
  parentCode?: string,
): Promise<string> {
  // ALWAYS try to load from the backend API first — it's the source of truth
  try {
    const accounts = await tryLoadAccountsFromApi();
    if (accounts && accounts.length > 0) {
      // Search across the whole supplier group (case-insensitive, trimmed) to avoid duplicates
      const normalizedName = supplierName.trim().toLowerCase();
      const existing = accounts.find(a =>
        a.code.startsWith(SUPPLIER_GROUP_CODE) &&
        a.code.length > 3 &&
        !a.is_header &&
        a.is_active !== false &&
        (
          a.name?.trim().toLowerCase() === normalizedName ||
          (supplierNif && supplierNif.trim() && a.description?.includes(supplierNif.trim()))
        )
      );

      if (existing) {
        console.log(`[CoA Engine] Found existing supplier account ${existing.code} — ${supplierName}`);
        return existing.code;
      }

      // Not found — create via API (with proper UUID id) under the chosen parent
      const resolvedParentCode = resolveSupplierParentCode(accounts, parentCode);
      const parent = accounts.find(a => a.code === resolvedParentCode);
      if (parent) {
        const code = nextEntityAccountCode(resolvedParentCode, accounts);

        const newAccount: Account = {
          id: generateId(), // MUST be a valid UUID for the backend
          code,
          name: supplierName.trim(),
          description: supplierNif ? `NIF: ${supplierNif}` : undefined,
          account_type: 'liability',
          account_nature: 'credit',
          parent_id: parent.id,
          parent_name: parent.name,
          parent_code: resolvedParentCode,
          level: (parent.level ?? 2) + 1,
          is_header: false,
          is_active: true,
          opening_balance: 0,
          current_balance: 0,
          branch_id: null,
          children_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Account;

        const created = await tryApiCreateAccount(newAccount);
        if (created) {
          console.log(`[CoA Engine] Created supplier account ${code} — ${supplierName} (via API)`);
        }
        // Also cache locally
        accounts.push(newAccount);
        saveAccountsLocal(accounts);
        return code;
      }
    }
  } catch (e) {
    console.warn('[CoA Engine] API lookup failed, falling back to localStorage:', e);
  }

  // Fallback: localStorage
  const localAccounts = loadAccountsLocal();
  const normalizedName = supplierName.trim().toLowerCase();
  const localExisting = localAccounts.find(a =>
    a.code.startsWith(SUPPLIER_GROUP_CODE) &&
    a.code.length > 3 &&
    !a.is_header &&
    (
      a.name?.trim().toLowerCase() === normalizedName ||
      (supplierNif && supplierNif.trim() && a.description?.includes(supplierNif.trim()))
    )
  );
  if (localExisting) return localExisting.code;

  // Create locally as last resort
  const resolvedParentCode = resolveSupplierParentCode(localAccounts, parentCode);
  const parent = localAccounts.find(a => a.code === resolvedParentCode);
  const code = nextEntityAccountCode(resolvedParentCode, localAccounts);

  const now = new Date().toISOString();
  localAccounts.push({
    id: generateId(),
    code,
    name: supplierName.trim(),
    description: supplierNif ? `NIF: ${supplierNif}` : undefined,
    account_type: 'liability',
    account_nature: 'credit',
    parent_id: parent?.id || null,
    parent_name: parent?.name || null,
    parent_code: resolvedParentCode,
    level: (parent?.level ?? 2) + 1,
    is_header: false,
    is_active: true,
    opening_balance: 0,
    current_balance: 0,
    branch_id: null,
    children_count: 0,
    created_at: now,
    updated_at: now,
  } as Account);
  saveAccountsLocal(localAccounts);
  console.log(`[CoA Engine] Created supplier account ${code} — ${supplierName} (localStorage fallback)`);
  return code;
}

// ============= CLIENT ACCOUNT =============

/**
 * Ensure a client has a sub-account under 3.1 (Clientes).
 * Returns the proper account code (e.g., "3.1.001").
 */
export async function ensureClientAccount(clientId: string, clientName: string, clientNif?: string): Promise<string> {
  let accounts = await tryLoadAccountsFromApi();
  const usingApi = accounts !== null;
  
  if (!accounts) {
    accounts = loadAccountsLocal();
  }
  
  const existing = accounts.find(a => 
    a.code.startsWith('311') && 
    a.code.length > 3 && 
    !a.is_header &&
    (a.name === clientName || (clientNif && a.description?.includes(clientNif)))
  );
  
  if (existing) return existing.code;
  
  const parent = accounts.find(a => a.code === '311');
  if (!parent) return '311001';
  
  const children = accounts.filter(a => a.code.startsWith('311') && a.code.length > 3 && !a.is_header);
  const nextSeq = children.length + 1;
  const code = `311${nextSeq.toString().padStart(3, '0')}`;
  
  const now = new Date().toISOString();
  const newAccount: Account = {
    id: `local-coa-client-${clientId}`,
    code,
    name: clientName,
    description: clientNif ? `NIF: ${clientNif}` : undefined,
    account_type: 'asset',
    account_nature: 'debit',
    parent_id: parent.id,
    parent_name: parent.name,
    parent_code: '311',
    level: 3,
    is_header: false,
    is_active: true,
    opening_balance: 0,
    current_balance: 0,
    branch_id: null,
    children_count: 0,
    created_at: now,
    updated_at: now,
  };
  
  if (usingApi) {
    await tryApiCreateAccount(newAccount);
  }
  
  const parentIdx = accounts.findIndex(a => a.id === parent.id);
  if (parentIdx >= 0) {
    accounts[parentIdx] = { ...accounts[parentIdx], children_count: (accounts[parentIdx].children_count || 0) + 1 };
  }
  accounts.push(newAccount);
  saveAccountsLocal(accounts);
  console.log(`[CoA Engine] Created client account ${code} — ${clientName}`);
  
  return code;
}

// ============= BALANCE UPDATES =============

/**
 * Update account balances in the Chart of Accounts from journal lines.
 * Now async — syncs to API when available.
 */
export async function updateCoABalancesFromJournal(lines: { accountCode: string; debit: number; credit: number }[]) {
  // Load from API if available, otherwise localStorage
  let accounts = await tryLoadAccountsFromApi();
  const usingApi = accounts !== null;
  
  if (!accounts) {
    accounts = loadAccountsLocal();
  }
  
  let changed = false;
  
  for (const line of lines) {
    const account = accounts.find(a => a.code === line.accountCode && a.is_active);
    if (!account) {
      console.warn(`[CoA Engine] Account ${line.accountCode} not found for balance update`);
      continue;
    }
    
    const balanceChange = account.account_nature === 'debit'
      ? (line.debit || 0) - (line.credit || 0)
      : (line.credit || 0) - (line.debit || 0);
    
    const idx = accounts.findIndex(a => a.id === account.id);
    if (idx >= 0) {
      accounts[idx] = {
        ...accounts[idx],
        current_balance: (accounts[idx].current_balance || 0) + balanceChange,
        updated_at: new Date().toISOString(),
      };
      changed = true;
      
      // Also update via API if available
      if (usingApi) {
        try {
          await api.chartOfAccounts.update(account.id, {
            current_balance: accounts[idx].current_balance,
          });
        } catch (e) {
          console.warn(`[CoA Engine] API balance update failed for ${account.code}:`, e);
        }
      }
      
      console.log(`[CoA Engine] ${account.code} ${account.name}: balance ${balanceChange >= 0 ? '+' : ''}${balanceChange.toFixed(2)} → ${accounts[idx].current_balance.toFixed(2)}`);
    }
  }
  
  if (changed) {
    rollUpParentBalances(accounts);
    saveAccountsLocal(accounts);
    
    // Update parent balances via API too
    if (usingApi) {
      const headers = accounts.filter(a => a.is_header);
      for (const header of headers) {
        try {
          await api.chartOfAccounts.update(header.id, {
            current_balance: header.current_balance,
          });
        } catch { /* best effort */ }
      }
    }
  }
}

/**
 * Roll up child account balances to parent header accounts
 */
function rollUpParentBalances(accounts: Account[]) {
  const headers = accounts.filter(a => a.is_header).sort((a, b) => b.level - a.level);
  
  for (const header of headers) {
    const children = accounts.filter(a => a.parent_id === header.id);
    if (children.length === 0) continue;
    
    const sum = children.reduce((total, child) => total + (child.current_balance || 0), 0);
    const idx = accounts.findIndex(a => a.id === header.id);
    if (idx >= 0) {
      accounts[idx] = { ...accounts[idx], current_balance: sum };
    }
  }
}
