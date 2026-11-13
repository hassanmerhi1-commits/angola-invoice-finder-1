import { api } from '@/lib/api/client';
import { Caixa, BankAccount } from '@/types/accounting';

export type FreightPaymentSource = 'caixa' | 'bank';

export type ResolvedFreightTreasury = {
  paymentSource: FreightPaymentSource;
  accountCode: string;
  accountName: string;
  caixaId?: string | null;
  bankAccountId?: string | null;
};

const BANK_GL = '431';

/** Account number first, so two drawers with the same name are not mixed up. */
export function caixaChoiceLabel(
  caixa: { name?: string; branchName?: string; glAccountCode?: string },
  options?: { branch?: boolean; balance?: string },
): string {
  const code = String(caixa.glAccountCode || '').trim();
  const name = String(caixa.name || '').trim();
  const branch = options?.branch ? String(caixa.branchName || '').trim() : '';
  const who = branch ? `${branch} — ${name}` : name;
  const head = code ? `${code} · ${who}` : who;
  return options?.balance ? `${head} (${options.balance} Kz)` : head;
}

export function formatFreightCaixaLabel(c: Caixa, locale: string, withBranch = false): string {
  const balance = Number(c.currentBalance || 0).toLocaleString(locale);
  return caixaChoiceLabel(c, { branch: withBranch, balance });
}

export function formatFreightBankLabel(a: BankAccount, withBranch = false): string {
  const branch = String(a.branchName || '').trim();
  const core = `${a.bankName} - ${a.accountNumber}`;
  if (withBranch && branch) return `${branch} — ${core}`;
  return `${a.currency ? `${core} (${a.currency})` : core}`;
}

/** Resolve treasury GL via server (caixa 45x) or local fallback for bank. */
export async function resolveFreightTreasuryGl(input: {
  paymentSource: FreightPaymentSource;
  caixaId?: string;
  bankAccountId?: string;
  branchId?: string;
  freightSourceAccount?: string;
  freightSourceName?: string;
  caixas?: Caixa[];
  bankAccounts?: BankAccount[];
}): Promise<ResolvedFreightTreasury> {
  const paymentSource = input.paymentSource || 'caixa';
  try {
    const res = await api.purchaseInvoices.resolveFreightTreasury({
      freightPaymentSource: paymentSource,
      freightCaixaId: input.caixaId,
      freightBankAccountId: input.bankAccountId,
      branchId: input.branchId,
      freightSourceAccount: input.freightSourceAccount,
      freightSourceName: input.freightSourceName,
    });
    if (res.data && !res.error) {
      const d = res.data as ResolvedFreightTreasury;
      return {
        paymentSource: (d.paymentSource as FreightPaymentSource) || paymentSource,
        accountCode: String(d.accountCode || ''),
        accountName: String(d.accountName || ''),
        caixaId: d.caixaId,
        bankAccountId: d.bankAccountId,
      };
    }
  } catch {
    /* offline fallback below */
  }

  if (paymentSource === 'bank') {
    const bank = input.bankAccounts?.find((b) => b.id === input.bankAccountId);
    return {
      paymentSource: 'bank',
      accountCode: BANK_GL,
      accountName: bank ? formatFreightBankLabel(bank) : 'Banco',
      bankAccountId: input.bankAccountId || null,
    };
  }

  const caixa = input.caixas?.find((c) => c.id === input.caixaId);
  return {
    paymentSource: 'caixa',
    accountCode: input.freightSourceAccount || '451',
    accountName: caixa ? formatFreightCaixaLabel(caixa, 'pt-AO') : (input.freightSourceName || 'Caixa'),
    caixaId: input.caixaId || null,
  };
}
