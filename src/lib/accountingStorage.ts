/**
 * Accounting Storage for NEXOR ERP
 * Handles Caixa, Bank Accounts, Expenses, and Cash Transactions
 * 
 * DUAL-MODE: Electron → SQLite (erp.db) | Web → localStorage
 */

import { 
  Caixa, 
  CaixaSession, 
  BankAccount, 
  Expense, 
  CashTransaction, 
  BankTransaction,
  MoneyTransfer,
  ExpenseCategory
} from '@/types/accounting';
import { format } from 'date-fns';
import { isElectronMode, dbGetAll, dbInsert, dbUpdate, dbDelete, lsGet, lsSet } from '@/lib/dbHelper';
import { api, ensureBackendAuthToken } from '@/lib/api/client';

// Angola PGC expense accounts (class 7 = Custos). Used to book cash/bank expenses to the GL.
const EXPENSE_GL_ACCOUNTS: Record<ExpenseCategory, string> = {
  staff: '722', // Remunerações - Pessoal
  transport: '752', // Fornecimentos e serviços de terceiros
  utilities: '752',
  materials: '752',
  maintenance: '752',
  other: '758', // Outros custos e perdas operacionais
};

function expenseGlAccount(category?: ExpenseCategory): string {
  return (category && EXPENSE_GL_ACCOUNTS[category]) || '758';
}

export type CaixaGlPostResult =
  | { ok: true; entryNumber?: string; alreadyPosted?: boolean }
  | { ok: false; error: string };

/**
 * Post a balanced GL journal entry for a cash movement against the branch caixa account.
 * Returns success/failure — callers should warn the user when GL posting fails.
 */
export async function postCaixaGlEntry(body: {
  branchId: string;
  amount: number;
  direction: 'in' | 'out';
  counterAccountCode: string;
  description: string;
  referenceType: string;
  referenceId?: string;
  createdBy?: string;
}): Promise<CaixaGlPostResult> {
  if (!body.branchId || !(body.amount > 0)) {
    return { ok: false, error: 'Dados de caixa inválidos para lançamento contabilístico' };
  }

  const token = await ensureBackendAuthToken();
  if (!token) {
    return {
      ok: false,
      error: 'Sessão não autenticada no servidor — faça login novamente para lançar na contabilidade',
    };
  }

  const res = await api.caixa.postGlEntry(body);
  if (res.error) {
    console.error('[ACCOUNTING] caixa GL post failed:', res.error);
    return { ok: false, error: res.error };
  }

  return {
    ok: true,
    entryNumber: res.data?.entryNumber,
    alreadyPosted: res.data?.alreadyPosted,
  };
}

// Storage keys (localStorage fallback)
const STORAGE_KEYS = {
  caixas: 'kwanzaerp_caixas',
  caixaSessions: 'kwanzaerp_caixa_sessions',
  bankAccounts: 'kwanzaerp_bank_accounts',
  expenses: 'kwanzaerp_expenses',
  cashTransactions: 'kwanzaerp_cash_transactions',
  bankTransactions: 'kwanzaerp_bank_transactions',
  moneyTransfers: 'kwanzaerp_money_transfers',
};

// ==================== CAIXA FUNCTIONS ====================

export async function getCaixas(branchId?: string): Promise<Caixa[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('caixas');
    let caixas = rows.map(mapCaixaFromDb);
    if (branchId) caixas = caixas.filter(c => c.branchId === branchId);
    return caixas;
  }
  const caixas = lsGet<Caixa[]>(STORAGE_KEYS.caixas, []);
  return branchId ? caixas.filter(c => c.branchId === branchId) : caixas;
}

export async function getCaixaById(id: string): Promise<Caixa | undefined> {
  const caixas = await getCaixas();
  return caixas.find(c => c.id === id);
}

export async function saveCaixa(caixa: Caixa): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('caixas', mapCaixaToDb(caixa));
    return;
  }
  const caixas = lsGet<Caixa[]>(STORAGE_KEYS.caixas, []);
  const index = caixas.findIndex(c => c.id === caixa.id);
  if (index >= 0) {
    caixas[index] = { ...caixa, updatedAt: new Date().toISOString() };
  } else {
    caixas.push(caixa);
  }
  lsSet(STORAGE_KEYS.caixas, caixas);
}

export async function createCaixa(
  branchId: string,
  branchName: string,
  name: string,
  openingBalance: number = 0,
  pettyLimit?: number,
  dailyLimit?: number
): Promise<Caixa> {
  const caixa: Caixa = {
    id: `caixa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    branchId,
    branchName,
    name,
    openingBalance,
    currentBalance: openingBalance,
    status: 'closed',
    pettyLimit,
    dailyLimit,
    requiresApproval: !!pettyLimit,
    createdAt: new Date().toISOString(),
  };
  await saveCaixa(caixa);
  return caixa;
}

export async function updateCaixaBalance(caixaId: string, amount: number, direction: 'in' | 'out'): Promise<void> {
  const caixa = await getCaixaById(caixaId);
  if (caixa) {
    caixa.currentBalance = direction === 'in' 
      ? caixa.currentBalance + amount 
      : caixa.currentBalance - amount;
    await saveCaixa(caixa);
  }
}

export async function ensureBranchCaixa(branchId: string, branchName: string): Promise<Caixa> {
  const existing = await getCaixas(branchId);
  if (existing.length > 0) {
    return existing[0];
  }
  return createCaixa(branchId, branchName, `Caixa Principal - ${branchName}`, 0);
}

export async function getOpenCaixaForBranch(branchId: string): Promise<Caixa | undefined> {
  const caixas = await getCaixas(branchId);
  return caixas.find(c => c.status === 'open');
}

export async function processSalePayment(
  branchId: string,
  saleId: string,
  invoiceNumber: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'transfer',
  cashierId: string,
  customerName?: string
): Promise<{ success: boolean; message: string; transaction?: CashTransaction; caixaName?: string; newBalance?: number }> {
  if (paymentMethod !== 'cash') {
    return { success: true, message: 'Non-cash payment - no Caixa update needed' };
  }
  
  const openCaixa = await getOpenCaixaForBranch(branchId);
  if (!openCaixa) {
    console.warn(`[CAIXA] No open Caixa for branch ${branchId} - sale recorded without Caixa entry`);
    return { 
      success: true, 
      message: 'Venda registada, mas nenhuma Caixa aberta para este balcão' 
    };
  }
  
  const openSession = await getOpenCaixaSession(openCaixa.id);
  if (!openSession) {
    console.warn(`[CAIXA] No open session for Caixa ${openCaixa.id}`);
    return { 
      success: true, 
      message: 'Venda registada, mas sessão de Caixa não encontrada' 
    };
  }
  
  const transaction = await createCashTransaction(
    openCaixa.id,
    branchId,
    'sale',
    amount,
    `Venda ${invoiceNumber}${customerName ? ` - ${customerName}` : ''}`,
    cashierId,
    undefined,
    customerName,
    'sale',
    saleId,
    invoiceNumber
  );
  
  await updateCaixaBalance(openCaixa.id, amount, 'in');
  
  const updatedCaixa = await getCaixaById(openCaixa.id);
  const newBalance = updatedCaixa?.currentBalance ?? openCaixa.currentBalance + amount;
  
  await updateCaixaSessionTotals(openSession.id, amount, 'sale');
  
  console.log(`[CAIXA] Sale ${invoiceNumber} recorded: +${amount.toLocaleString('pt-AO')} Kz to ${openCaixa.name}`);
  
  return { 
    success: true, 
    message: 'Venda registada na Caixa',
    transaction,
    caixaName: openCaixa.name,
    newBalance
  };
}

/** Cash refund when a credit note is issued against a cash POS sale. */
export async function processSaleRefund(
  branchId: string,
  creditNoteId: string,
  documentNumber: string,
  originalInvoiceNumber: string,
  amount: number,
  cashierId: string,
  customerName?: string,
): Promise<{ success: boolean; message: string; transaction?: CashTransaction; caixaName?: string; newBalance?: number }> {
  const openCaixa = await getOpenCaixaForBranch(branchId);
  if (!openCaixa) {
    console.warn(`[CAIXA] No open Caixa for branch ${branchId} - refund recorded without Caixa entry`);
    return {
      success: true,
      message: 'Devolução registada, mas nenhuma Caixa aberta para este balcão',
    };
  }

  const openSession = await getOpenCaixaSession(openCaixa.id);
  if (!openSession) {
    console.warn(`[CAIXA] No open session for Caixa ${openCaixa.id}`);
    return {
      success: true,
      message: 'Devolução registada, mas sessão de Caixa não encontrada',
    };
  }

  const transaction = await createCashTransaction(
    openCaixa.id,
    branchId,
    'sale_refund',
    amount,
    `Devolução ${documentNumber} (fatura ${originalInvoiceNumber})${customerName ? ` - ${customerName}` : ''}`,
    cashierId,
    undefined,
    customerName,
    'sale',
    creditNoteId,
    documentNumber,
  );

  await updateCaixaBalance(openCaixa.id, amount, 'out');

  const updatedCaixa = await getCaixaById(openCaixa.id);
  const newBalance = updatedCaixa?.currentBalance ?? openCaixa.currentBalance - amount;

  await updateCaixaSessionTotals(openSession.id, amount, 'sale_refund');

  console.log(`[CAIXA] Refund ${documentNumber} recorded: -${amount.toLocaleString('pt-AO')} Kz from ${openCaixa.name}`);

  return {
    success: true,
    message: 'Devolução registada na Caixa',
    transaction,
    caixaName: openCaixa.name,
    newBalance,
  };
}

export async function updateCaixaSessionTotals(
  sessionId: string, 
  amount: number, 
  type: 'sale' | 'sale_refund' | 'expense' | 'deposit' | 'withdrawal' | 'adjustment'
): Promise<void> {
  if (isElectronMode()) {
    // For Electron, update the session in the DB
    const sessions = await getCaixaSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    switch (type) {
      case 'sale': case 'deposit':
        session.totalIn += amount;
        if (type === 'sale') session.salesTotal += amount;
        break;
      case 'expense': case 'withdrawal':
        session.totalOut += amount;
        if (type === 'expense') session.expensesTotal += amount;
        break;
      case 'sale_refund':
        session.totalOut += amount;
        break;
      case 'adjustment':
        session.adjustments += amount;
        if (amount > 0) session.totalIn += amount;
        else session.totalOut += Math.abs(amount);
        break;
    }
    await dbInsert('caixa_sessions', mapCaixaSessionToDb(session));
    return;
  }
  const sessions = lsGet<CaixaSession[]>(STORAGE_KEYS.caixaSessions, []);
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    switch (type) {
      case 'sale': case 'deposit':
        session.totalIn += amount;
        if (type === 'sale') session.salesTotal += amount;
        break;
      case 'expense': case 'withdrawal':
        session.totalOut += amount;
        if (type === 'expense') session.expensesTotal += amount;
        break;
      case 'sale_refund':
        session.totalOut += amount;
        break;
      case 'adjustment':
        session.adjustments += amount;
        if (amount > 0) session.totalIn += amount;
        else session.totalOut += Math.abs(amount);
        break;
    }
    lsSet(STORAGE_KEYS.caixaSessions, sessions);
  }
}

// ==================== CAIXA SESSION FUNCTIONS ====================

export async function getCaixaSessions(caixaId?: string, date?: string): Promise<CaixaSession[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('caixa_sessions');
    let sessions = rows.map(mapCaixaSessionFromDb);
    if (caixaId) sessions = sessions.filter(s => s.caixaId === caixaId);
    if (date) sessions = sessions.filter(s => s.date === date);
    return sessions;
  }
  const sessions = lsGet<CaixaSession[]>(STORAGE_KEYS.caixaSessions, []);
  let filtered = sessions;
  if (caixaId) filtered = filtered.filter(s => s.caixaId === caixaId);
  if (date) filtered = filtered.filter(s => s.date === date);
  return filtered;
}

export async function getOpenCaixaSession(caixaId: string): Promise<CaixaSession | undefined> {
  const sessions = await getCaixaSessions(caixaId);
  return sessions.find(s => s.status === 'open');
}

export async function openCaixaSession(
  caixaId: string, 
  branchId: string, 
  openingBalance: number, 
  openedBy: string
): Promise<CaixaSession> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const session: CaixaSession = {
    id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    caixaId,
    branchId,
    date: today,
    openingBalance,
    totalIn: 0,
    totalOut: 0,
    salesTotal: 0,
    expensesTotal: 0,
    adjustments: 0,
    status: 'open',
    openedBy,
    openedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  
  if (isElectronMode()) {
    await dbInsert('caixa_sessions', mapCaixaSessionToDb(session));
  } else {
    const sessions = lsGet<CaixaSession[]>(STORAGE_KEYS.caixaSessions, []);
    sessions.push(session);
    lsSet(STORAGE_KEYS.caixaSessions, sessions);
  }
  
  const caixa = await getCaixaById(caixaId);
  if (caixa) {
    caixa.status = 'open';
    caixa.openedAt = session.openedAt;
    caixa.openedBy = openedBy;
    await saveCaixa(caixa);
  }
  
  return session;
}

export async function closeCaixaSession(
  sessionId: string,
  closingBalance: number,
  closedBy: string,
  notes?: string
): Promise<void> {
  if (isElectronMode()) {
    const sessions = await getCaixaSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.closingBalance = closingBalance;
      session.closedBy = closedBy;
      session.closedAt = new Date().toISOString();
      session.status = 'closed';
      session.notes = notes;
      await dbInsert('caixa_sessions', mapCaixaSessionToDb(session));
      
      const caixa = await getCaixaById(session.caixaId);
      if (caixa) {
        caixa.status = 'closed';
        caixa.closedAt = session.closedAt;
        caixa.closedBy = closedBy;
        caixa.closingBalance = closingBalance;
        caixa.closingNotes = notes;
        await saveCaixa(caixa);
      }

      try {
        const { enqueueCaixaCloseSync } = await import('@/lib/sync/clientOutbox');
        await enqueueCaixaCloseSync({
          sessionData: { ...session },
          ...(caixa ? { caixaData: { ...caixa } } : {}),
        });
      } catch {
        /* non-fatal */
      }
    }
    return;
  }
  const sessions = lsGet<CaixaSession[]>(STORAGE_KEYS.caixaSessions, []);
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    session.closingBalance = closingBalance;
    session.closedBy = closedBy;
    session.closedAt = new Date().toISOString();
    session.status = 'closed';
    session.notes = notes;
    lsSet(STORAGE_KEYS.caixaSessions, sessions);
    
    const caixa = await getCaixaById(session.caixaId);
    if (caixa) {
      caixa.status = 'closed';
      caixa.closedAt = session.closedAt;
      caixa.closedBy = closedBy;
      caixa.closingBalance = closingBalance;
      caixa.closingNotes = notes;
      await saveCaixa(caixa);
    }
  }
}

// ==================== BANK ACCOUNT FUNCTIONS ====================

export async function getBankAccounts(branchId?: string): Promise<BankAccount[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('bank_accounts');
    let accounts = rows.map(mapBankAccountFromDb);
    if (branchId) accounts = accounts.filter(a => a.branchId === branchId);
    return accounts;
  }
  const accounts = lsGet<BankAccount[]>(STORAGE_KEYS.bankAccounts, []);
  return branchId ? accounts.filter(a => a.branchId === branchId) : accounts;
}

export async function getBankAccountById(id: string): Promise<BankAccount | undefined> {
  const accounts = await getBankAccounts();
  return accounts.find(a => a.id === id);
}

export async function saveBankAccount(account: BankAccount): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('bank_accounts', mapBankAccountToDb(account));
    return;
  }
  const accounts = lsGet<BankAccount[]>(STORAGE_KEYS.bankAccounts, []);
  const index = accounts.findIndex(a => a.id === account.id);
  if (index >= 0) {
    accounts[index] = { ...account, updatedAt: new Date().toISOString() };
  } else {
    accounts.push(account);
  }
  lsSet(STORAGE_KEYS.bankAccounts, accounts);
}

export async function createBankAccount(
  branchId: string,
  branchName: string,
  bankName: string,
  accountName: string,
  accountNumber: string,
  currency: 'AOA' | 'USD' | 'EUR' = 'AOA',
  openingBalance: number = 0,
  iban?: string
): Promise<BankAccount> {
  const existing = await getBankAccounts(branchId);
  const account: BankAccount = {
    id: `bank_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    branchId,
    branchName,
    bankName,
    accountName,
    accountNumber,
    iban,
    currency,
    currentBalance: openingBalance,
    isActive: true,
    isPrimary: existing.length === 0,
    createdAt: new Date().toISOString(),
  };
  await saveBankAccount(account);
  return account;
}

// ==================== EXPENSE FUNCTIONS ====================

export async function getExpenses(branchId?: string): Promise<Expense[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('expenses');
    let expenses = rows.map(mapExpenseFromDb);
    if (branchId) expenses = expenses.filter(e => e.branchId === branchId);
    return expenses;
  }
  const expenses = lsGet<Expense[]>(STORAGE_KEYS.expenses, []);
  return branchId ? expenses.filter(e => e.branchId === branchId) : expenses;
}

export async function getExpenseById(id: string): Promise<Expense | undefined> {
  const expenses = await getExpenses();
  return expenses.find(e => e.id === id);
}

export function generateExpenseNumber(branchCode: string): string {
  // Synchronous for compatibility — sequence from timestamp
  const today = format(new Date(), 'yyyyMMdd');
  const seq = Date.now().toString().slice(-3);
  return `DESP-${branchCode}-${today}-${seq}`;
}

export async function saveExpense(expense: Expense): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('expenses', mapExpenseToDb(expense));
    return;
  }
  const expenses = lsGet<Expense[]>(STORAGE_KEYS.expenses, []);
  const index = expenses.findIndex(e => e.id === expense.id);
  if (index >= 0) {
    expenses[index] = { ...expense, updatedAt: new Date().toISOString() };
  } else {
    expenses.push(expense);
  }
  lsSet(STORAGE_KEYS.expenses, expenses);
}

export async function createExpense(
  branchId: string,
  branchName: string,
  branchCode: string,
  category: ExpenseCategory,
  description: string,
  amount: number,
  paymentSource: 'caixa' | 'bank',
  requestedBy: string,
  caixaId?: string,
  bankAccountId?: string,
  payeeName?: string,
  taxAmount?: number,
  invoiceNumber?: string,
  notes?: string
): Promise<Expense> {
  const expense: Expense = {
    id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    expenseNumber: generateExpenseNumber(branchCode),
    branchId,
    branchName,
    category,
    description,
    amount,
    taxAmount: taxAmount || 0,
    totalAmount: amount + (taxAmount || 0),
    paymentSource,
    caixaId,
    bankAccountId,
    payeeName,
    invoiceNumber,
    status: 'draft',
    requestedBy,
    requestedAt: new Date().toISOString(),
    notes,
    createdAt: new Date().toISOString(),
  };
  await saveExpense(expense);
  return expense;
}

export async function payExpense(
  expenseId: string,
  paidBy: string,
  createTransaction: boolean = true
): Promise<{ glError?: string }> {
  const expense = await getExpenseById(expenseId);
  if (!expense) return {};
  
  expense.status = 'paid';
  expense.paidBy = paidBy;
  expense.paidAt = new Date().toISOString();
  let glError: string | undefined;
  
  if (createTransaction) {
    if (expense.paymentSource === 'caixa' && expense.caixaId) {
      const transaction = await createCashTransaction(
        expense.caixaId,
        expense.branchId,
        'expense',
        expense.totalAmount,
        `Despesa: ${expense.description}`,
        paidBy,
        expense.category,
        expense.payeeName,
        'expense',
        expense.id,
        expense.expenseNumber
      );
      expense.transactionId = transaction.id;
      await updateCaixaBalance(expense.caixaId, expense.totalAmount, 'out');
      const openSession = await getOpenCaixaSession(expense.caixaId);
      if (openSession) {
        await updateCaixaSessionTotals(openSession.id, expense.totalAmount, 'expense');
      }
      // GL: Dr expense account, Cr branch caixa — so the branch cash account reflects the payout.
      const glResult = await postCaixaGlEntry({
        branchId: expense.branchId,
        amount: expense.totalAmount,
        direction: 'out',
        counterAccountCode: expenseGlAccount(expense.category),
        description: `Despesa: ${expense.description}`,
        referenceType: 'expense',
        referenceId: expense.id,
        createdBy: paidBy,
      });
      if (!glResult.ok) glError = glResult.error;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('nexor:pos-caixa-expense', {
            detail: {
              branchId: expense.branchId,
              caixaId: expense.caixaId,
              amount: expense.totalAmount,
            },
          }),
        );
      }
    } else if (expense.paymentSource === 'bank' && expense.bankAccountId) {
      const transaction = await createBankTransaction(
        expense.bankAccountId,
        expense.branchId,
        'expense',
        expense.totalAmount,
        `Despesa: ${expense.description}`,
        paidBy,
        expense.category,
        expense.payeeName,
        'expense',
        expense.id,
        expense.expenseNumber
      );
      expense.transactionId = transaction.id;
      const account = await getBankAccountById(expense.bankAccountId);
      if (account) {
        account.currentBalance -= expense.totalAmount;
        await saveBankAccount(account);
      }
    }
  }
  
  await saveExpense(expense);
  return glError ? { glError } : {};
}

// ==================== CASH TRANSACTION FUNCTIONS ====================

export async function getCashTransactions(caixaId?: string): Promise<CashTransaction[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('caixa_transactions');
    let txns = rows.map(mapCashTransactionFromDb);
    if (caixaId) txns = txns.filter(t => t.caixaId === caixaId);
    return txns;
  }
  const transactions = lsGet<CashTransaction[]>(STORAGE_KEYS.cashTransactions, []);
  return caixaId ? transactions.filter(t => t.caixaId === caixaId) : transactions;
}

export async function createCashTransaction(
  caixaId: string,
  branchId: string,
  type: CashTransaction['type'],
  amount: number,
  description: string,
  createdBy: string,
  category?: ExpenseCategory,
  payee?: string,
  referenceType?: CashTransaction['referenceType'],
  referenceId?: string,
  referenceNumber?: string,
  notes?: string
): Promise<CashTransaction> {
  const caixa = await getCaixaById(caixaId);
  const direction: 'in' | 'out' = ['sale', 'deposit', 'transfer_in', 'opening'].includes(type) ? 'in' : 'out';
  const balanceAfter = caixa ? (direction === 'in' ? caixa.currentBalance + amount : caixa.currentBalance - amount) : 0;
  
  const transaction: CashTransaction = {
    id: `ct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    caixaId,
    branchId,
    type,
    direction,
    amount,
    balanceAfter,
    referenceType,
    referenceId,
    referenceNumber,
    description,
    category,
    payee,
    createdBy,
    createdAt: new Date().toISOString(),
    notes,
  };
  
  if (isElectronMode()) {
    await dbInsert('caixa_transactions', mapCashTransactionToDb(transaction));
  } else {
    const transactions = lsGet<CashTransaction[]>(STORAGE_KEYS.cashTransactions, []);
    transactions.push(transaction);
    lsSet(STORAGE_KEYS.cashTransactions, transactions);
  }
  
  return transaction;
}

// ==================== BANK TRANSACTION FUNCTIONS ====================

export async function getBankTransactions(bankAccountId?: string): Promise<BankTransaction[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('bank_transactions');
    let txns = rows.map(mapBankTransactionFromDb);
    if (bankAccountId) txns = txns.filter(t => t.bankAccountId === bankAccountId);
    return txns;
  }
  const transactions = lsGet<BankTransaction[]>(STORAGE_KEYS.bankTransactions, []);
  return bankAccountId ? transactions.filter(t => t.bankAccountId === bankAccountId) : transactions;
}

export async function createBankTransaction(
  bankAccountId: string,
  branchId: string,
  type: BankTransaction['type'],
  amount: number,
  description: string,
  createdBy: string,
  category?: ExpenseCategory,
  payee?: string,
  referenceType?: BankTransaction['referenceType'],
  referenceId?: string,
  referenceNumber?: string,
  notes?: string
): Promise<BankTransaction> {
  const account = await getBankAccountById(bankAccountId);
  const direction: 'in' | 'out' = ['sale', 'deposit', 'transfer_in', 'opening'].includes(type) ? 'in' : 'out';
  const balanceAfter = account ? (direction === 'in' ? account.currentBalance + amount : account.currentBalance - amount) : 0;
  
  const transaction: BankTransaction = {
    id: `bt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    bankAccountId,
    branchId,
    type,
    direction,
    amount,
    balanceAfter,
    referenceType,
    referenceId,
    referenceNumber,
    transactionDate: new Date().toISOString(),
    description,
    category,
    payee,
    createdBy,
    createdAt: new Date().toISOString(),
    notes,
  };
  
  if (isElectronMode()) {
    await dbInsert('bank_transactions', mapBankTransactionToDb(transaction));
  } else {
    const transactions = lsGet<BankTransaction[]>(STORAGE_KEYS.bankTransactions, []);
    transactions.push(transaction);
    lsSet(STORAGE_KEYS.bankTransactions, transactions);
  }
  
  return transaction;
}

// ==================== MONEY TRANSFER FUNCTIONS (DOUBLE-ENTRY) ====================

const TRANSFER_STORAGE_KEY = 'kwanzaerp_money_transfers';

export async function getMoneyTransfers(branchId?: string): Promise<MoneyTransfer[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('money_transfers');
    let transfers = rows.map(mapMoneyTransferFromDb);
    if (branchId) transfers = transfers.filter(t => t.branchId === branchId);
    return transfers;
  }
  const transfers = lsGet<MoneyTransfer[]>(TRANSFER_STORAGE_KEY, []);
  return branchId ? transfers.filter(t => t.branchId === branchId) : transfers;
}

export function generateTransferNumber(branchCode: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Date.now().toString().slice(-4);
  return `TRF-${branchCode}/${today}/${seq}`;
}

export async function executeMoneyTransfer(
  branchId: string,
  branchCode: string,
  sourceType: 'caixa' | 'bank',
  sourceId: string,
  destinationType: 'caixa' | 'bank',
  destinationId: string,
  amount: number,
  reason: string,
  createdBy: string,
  notes?: string
): Promise<{ success: boolean; transfer?: MoneyTransfer; error?: string }> {
  
  let sourceBalance = 0;
  let sourceDescription = '';
  let destinationDescription = '';
  
  if (sourceType === 'caixa') {
    const caixa = await getCaixaById(sourceId);
    if (!caixa) return { success: false, error: 'Caixa de origem não encontrada' };
    if (caixa.status !== 'open') return { success: false, error: 'Caixa de origem não está aberta' };
    sourceBalance = caixa.currentBalance;
    sourceDescription = caixa.name;
  } else {
    const bank = await getBankAccountById(sourceId);
    if (!bank) return { success: false, error: 'Conta bancária de origem não encontrada' };
    sourceBalance = bank.currentBalance;
    sourceDescription = `${bank.bankName} - ${bank.accountNumber}`;
  }
  
  if (sourceBalance < amount) {
    return { success: false, error: `Saldo insuficiente. Disponível: ${sourceBalance.toLocaleString('pt-AO')} Kz` };
  }
  
  if (destinationType === 'caixa') {
    const caixa = await getCaixaById(destinationId);
    if (!caixa) return { success: false, error: 'Caixa de destino não encontrada' };
    destinationDescription = caixa.name;
  } else {
    const bank = await getBankAccountById(destinationId);
    if (!bank) return { success: false, error: 'Conta bancária de destino não encontrada' };
    destinationDescription = `${bank.bankName} - ${bank.accountNumber}`;
  }
  
  const transferNumber = generateTransferNumber(branchCode);
  
  const transfer: MoneyTransfer = {
    id: `trf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    transferNumber,
    branchId,
    sourceType,
    sourceCaixaId: sourceType === 'caixa' ? sourceId : undefined,
    sourceBankAccountId: sourceType === 'bank' ? sourceId : undefined,
    sourceDescription,
    destinationType,
    destinationCaixaId: destinationType === 'caixa' ? destinationId : undefined,
    destinationBankAccountId: destinationType === 'bank' ? destinationId : undefined,
    destinationDescription,
    amount,
    status: 'completed',
    reason,
    createdBy,
    createdAt: new Date().toISOString(),
    completedBy: createdBy,
    completedAt: new Date().toISOString(),
    notes
  };
  
  // 1. CREDIT: Deduct from source
  if (sourceType === 'caixa') {
    await createCashTransaction(sourceId, branchId, 'transfer_out', amount,
      `Transferência para ${destinationDescription}: ${reason}`, createdBy,
      undefined, destinationDescription, 'transfer', transfer.id, transferNumber);
    await updateCaixaBalance(sourceId, amount, 'out');
    const session = await getOpenCaixaSession(sourceId);
    if (session) await updateCaixaSessionTotals(session.id, amount, 'withdrawal');
  } else {
    await createBankTransaction(sourceId, branchId, 'transfer_out', amount,
      `Transferência para ${destinationDescription}: ${reason}`, createdBy,
      undefined, destinationDescription, 'transfer', transfer.id, transferNumber);
    const sourceBank = await getBankAccountById(sourceId);
    if (sourceBank) {
      sourceBank.currentBalance -= amount;
      await saveBankAccount(sourceBank);
    }
  }
  
  // 2. DEBIT: Add to destination
  if (destinationType === 'caixa') {
    await createCashTransaction(destinationId, branchId, 'transfer_in', amount,
      `Transferência de ${sourceDescription}: ${reason}`, createdBy,
      undefined, sourceDescription, 'transfer', transfer.id, transferNumber);
    await updateCaixaBalance(destinationId, amount, 'in');
    const session = await getOpenCaixaSession(destinationId);
    if (session) await updateCaixaSessionTotals(session.id, amount, 'deposit');
  } else {
    await createBankTransaction(destinationId, branchId, 'transfer_in', amount,
      `Transferência de ${sourceDescription}: ${reason}`, createdBy,
      undefined, sourceDescription, 'transfer', transfer.id, transferNumber);
    const destBank = await getBankAccountById(destinationId);
    if (destBank) {
      destBank.currentBalance += amount;
      await saveBankAccount(destBank);
    }
  }
  
  // GL: only transfers that move cash in/out of the branch caixa affect the branch cash
  // account. caixa↔bank posts one balanced entry against 431 (bank). caixa↔caixa within the
  // same branch nets to zero on the single branch GL account, and bank↔bank never touches it.
  let glError: string | undefined;
  if (sourceType === 'caixa' && destinationType === 'bank') {
    const glResult = await postCaixaGlEntry({
      branchId,
      amount,
      direction: 'out',
      counterAccountCode: '431',
      description: `Transferência para ${destinationDescription}: ${reason}`,
      referenceType: 'transfer',
      referenceId: transfer.id,
      createdBy,
    });
    if (!glResult.ok) glError = glResult.error;
  } else if (sourceType === 'bank' && destinationType === 'caixa') {
    const glResult = await postCaixaGlEntry({
      branchId,
      amount,
      direction: 'in',
      counterAccountCode: '431',
      description: `Transferência de ${sourceDescription}: ${reason}`,
      referenceType: 'transfer',
      referenceId: transfer.id,
      createdBy,
    });
    if (!glResult.ok) glError = glResult.error;
  }

  // Save transfer record
  if (isElectronMode()) {
    await dbInsert('money_transfers', mapMoneyTransferToDb(transfer));
  } else {
    const transfers = lsGet<MoneyTransfer[]>(TRANSFER_STORAGE_KEY, []);
    transfers.push(transfer);
    lsSet(TRANSFER_STORAGE_KEY, transfers);
  }
  
  console.log(`[TRANSFER] ${transferNumber}: ${amount.toLocaleString('pt-AO')} Kz from ${sourceDescription} to ${destinationDescription}`);
  
  return { success: true, transfer, glError };
}

// ==================== INITIALIZATION ====================

export async function initializeBranchAccounting(branchId: string, branchName: string, branchCode: string): Promise<void> {
  const existingCaixas = await getCaixas(branchId);
  if (existingCaixas.length === 0) {
    await createCaixa(branchId, branchName, 'Caixa Principal', 0, 50000, 200000);
  }
}

// ==================== DB MAPPERS ====================

function mapCaixaFromDb(row: any): Caixa {
  return {
    id: row.id, branchId: row.branch_id || '', branchName: row.branch_name || '',
    name: row.name || '', openingBalance: Number(row.opening_balance || 0),
    currentBalance: Number(row.current_balance ?? row.closing_balance ?? 0),
    status: row.status || 'closed',
    pettyLimit: row.petty_limit ? Number(row.petty_limit) : undefined,
    dailyLimit: row.daily_limit ? Number(row.daily_limit) : undefined,
    requiresApproval: !!row.requires_approval,
    openedBy: row.opened_by, openedAt: row.opened_at,
    closedBy: row.closed_by, closedAt: row.closed_at,
    closingBalance: row.closing_balance ? Number(row.closing_balance) : undefined,
    closingNotes: row.notes, createdAt: row.created_at || '',
    updatedAt: row.updated_at,
  };
}

function mapCaixaToDb(caixa: Caixa): any {
  return {
    id: caixa.id, name: caixa.name, branch_id: caixa.branchId,
    branch_name: caixa.branchName,
    opened_by: caixa.openedBy || '', closed_by: caixa.closedBy || '',
    opening_balance: caixa.openingBalance,
    current_balance: caixa.currentBalance,
    closing_balance: caixa.closingBalance ?? 0,
    cash_sales: 0, card_sales: 0, transfer_sales: 0,
    withdrawals: 0, deposits: 0, status: caixa.status,
    opened_at: caixa.openedAt || '', closed_at: caixa.closedAt || '',
    petty_limit: caixa.pettyLimit || 0,
    daily_limit: caixa.dailyLimit || 0,
    requires_approval: caixa.requiresApproval ? 1 : 0,
    notes: caixa.closingNotes || '',
  };
}

function mapCaixaSessionFromDb(row: any): CaixaSession {
  return {
    id: row.id, caixaId: row.caixa_id || '', branchId: row.branch_id || '',
    date: row.date || '', openingBalance: Number(row.opening_balance || 0),
    closingBalance: row.closing_balance ? Number(row.closing_balance) : undefined,
    totalIn: Number(row.total_in || 0), totalOut: Number(row.total_out || 0),
    salesTotal: Number(row.sales_total || 0), expensesTotal: Number(row.expenses_total || 0),
    adjustments: Number(row.adjustments || 0), status: row.status || 'open',
    openedBy: row.opened_by || '', openedAt: row.opened_at || '',
    closedBy: row.closed_by, closedAt: row.closed_at,
    notes: row.notes, createdAt: row.created_at || '',
  };
}

function mapCaixaSessionToDb(session: CaixaSession): any {
  return {
    id: session.id, caixa_id: session.caixaId, branch_id: session.branchId,
    date: session.date, opening_balance: session.openingBalance,
    closing_balance: session.closingBalance || 0,
    total_in: session.totalIn, total_out: session.totalOut,
    sales_total: session.salesTotal, expenses_total: session.expensesTotal,
    adjustments: session.adjustments, status: session.status,
    opened_by: session.openedBy, opened_at: session.openedAt,
    closed_by: session.closedBy || '', closed_at: session.closedAt || '',
    notes: session.notes || '',
  };
}

function mapBankAccountFromDb(row: any): BankAccount {
  return {
    id: row.id, branchId: row.branch_id || '', branchName: row.branch_name || '',
    bankName: row.bank_name || '', accountName: row.name || '',
    accountNumber: row.account_number || '', iban: row.iban,
    currency: row.currency || 'AOA',
    currentBalance: Number(row.balance || 0),
    isActive: !!(row.is_active ?? true), isPrimary: !!row.is_primary,
    createdAt: row.created_at || '', updatedAt: row.updated_at,
  };
}

function mapBankAccountToDb(account: BankAccount): any {
  return {
    id: account.id, name: account.accountName, bank_name: account.bankName,
    account_number: account.accountNumber, iban: account.iban || '',
    branch_id: account.branchId, branch_name: account.branchName || '',
    currency: account.currency, balance: account.currentBalance,
    is_active: account.isActive ? 1 : 0, is_primary: account.isPrimary ? 1 : 0,
  };
}

function mapExpenseFromDb(row: any): Expense {
  return {
    id: row.id, expenseNumber: row.expense_number || '',
    branchId: row.branch_id || '', branchName: row.branch_name || '',
    category: row.category || 'other', description: row.description || '',
    amount: Number(row.amount || 0), taxAmount: Number(row.tax_amount || 0),
    totalAmount: Number(row.total_amount || row.amount || 0),
    paymentSource: row.payment_source || row.payment_method || 'caixa',
    caixaId: row.caixa_id, bankAccountId: row.bank_account_id,
    payeeName: row.payee_name, invoiceNumber: row.invoice_number,
    status: row.status || 'draft',
    requestedBy: row.created_by || '', requestedAt: row.created_at || '',
    approvedBy: row.approved_by, approvedAt: row.approved_at,
    paidBy: row.paid_by, paidAt: row.paid_at,
    transactionId: row.transaction_id,
    notes: row.notes, createdAt: row.created_at || '', updatedAt: row.updated_at,
  };
}

function mapExpenseToDb(expense: Expense): any {
  return {
    id: expense.id, expense_number: expense.expenseNumber,
    description: expense.description, category: expense.category,
    amount: expense.amount, tax_amount: expense.taxAmount,
    total_amount: expense.totalAmount, branch_id: expense.branchId,
    branch_name: expense.branchName, payment_source: expense.paymentSource,
    payment_method: expense.paymentSource,
    caixa_id: expense.caixaId || '', bank_account_id: expense.bankAccountId || '',
    payee_name: expense.payeeName || '', invoice_number: expense.invoiceNumber || '',
    status: expense.status, created_by: expense.requestedBy,
    approved_by: expense.approvedBy || '', approved_at: expense.approvedAt || '',
    paid_by: expense.paidBy || '', paid_at: expense.paidAt || '',
    transaction_id: expense.transactionId || '',
    notes: expense.notes || '',
  };
}

function mapCashTransactionFromDb(row: any): CashTransaction {
  return {
    id: row.id, caixaId: row.caixa_id || '', branchId: row.branch_id || '',
    type: row.type || 'sale',
    direction: ['sale', 'deposit', 'transfer_in', 'opening'].includes(row.type) ? 'in' : 'out',
    amount: Number(row.amount || 0), balanceAfter: Number(row.balance_after || 0),
    referenceType: row.reference_type, referenceId: row.reference_id,
    referenceNumber: row.reference_number, description: row.description || '',
    category: row.category, payee: row.payee,
    createdBy: row.created_by || '', createdAt: row.created_at || '',
    notes: row.notes,
  };
}

function mapCashTransactionToDb(txn: CashTransaction): any {
  return {
    id: txn.id, caixa_id: txn.caixaId, type: txn.type,
    amount: txn.amount, description: txn.description,
    reference_id: txn.referenceId || '', reference_type: txn.referenceType || '',
    reference_number: txn.referenceNumber || '',
    balance_after: txn.balanceAfter, branch_id: txn.branchId,
    category: txn.category || '', payee: txn.payee || '',
    created_by: txn.createdBy, notes: txn.notes || '',
  };
}

function mapBankTransactionFromDb(row: any): BankTransaction {
  return {
    id: row.id, bankAccountId: row.account_id || row.bank_account_id || '',
    branchId: row.branch_id || '', type: row.type || 'deposit',
    direction: ['sale', 'deposit', 'transfer_in', 'opening'].includes(row.type) ? 'in' : 'out',
    amount: Number(row.amount || 0), balanceAfter: Number(row.balance_after || 0),
    referenceType: row.reference_type, referenceId: row.reference_id,
    referenceNumber: row.reference_number,
    transactionDate: row.transaction_date || row.created_at || '',
    description: row.description || '', category: row.category, payee: row.payee,
    createdBy: row.created_by || '', createdAt: row.created_at || '',
    notes: row.notes,
  };
}

function mapBankTransactionToDb(txn: BankTransaction): any {
  return {
    id: txn.id, account_id: txn.bankAccountId, type: txn.type,
    amount: txn.amount, description: txn.description,
    reference: txn.referenceNumber || '', balance_after: txn.balanceAfter,
    reference_type: txn.referenceType || '', reference_id: txn.referenceId || '',
    reference_number: txn.referenceNumber || '',
    transaction_date: txn.transactionDate, branch_id: txn.branchId,
    category: txn.category || '', payee: txn.payee || '',
    created_by: txn.createdBy, notes: txn.notes || '',
  };
}

function mapMoneyTransferFromDb(row: any): MoneyTransfer {
  return {
    id: row.id, transferNumber: row.transfer_number || '',
    branchId: row.branch_id || '',
    sourceType: row.source_type || 'caixa',
    sourceCaixaId: row.source_caixa_id, sourceBankAccountId: row.source_bank_account_id,
    sourceDescription: row.source_description || '',
    destinationType: row.destination_type || 'caixa',
    destinationCaixaId: row.destination_caixa_id,
    destinationBankAccountId: row.destination_bank_account_id,
    destinationDescription: row.destination_description || '',
    amount: Number(row.amount || 0), status: row.status || 'completed',
    reason: row.reason || '', createdBy: row.created_by || '',
    createdAt: row.created_at || '', completedBy: row.completed_by,
    completedAt: row.completed_at, notes: row.notes,
  };
}

function mapMoneyTransferToDb(transfer: MoneyTransfer): any {
  return {
    id: transfer.id, transfer_number: transfer.transferNumber,
    branch_id: transfer.branchId, source_type: transfer.sourceType,
    source_caixa_id: transfer.sourceCaixaId || '',
    source_bank_account_id: transfer.sourceBankAccountId || '',
    source_description: transfer.sourceDescription,
    destination_type: transfer.destinationType,
    destination_caixa_id: transfer.destinationCaixaId || '',
    destination_bank_account_id: transfer.destinationBankAccountId || '',
    destination_description: transfer.destinationDescription,
    amount: transfer.amount, status: transfer.status,
    reason: transfer.reason, created_by: transfer.createdBy,
    completed_by: transfer.completedBy || '',
    completed_at: transfer.completedAt || '',
    notes: transfer.notes || '',
  };
}
