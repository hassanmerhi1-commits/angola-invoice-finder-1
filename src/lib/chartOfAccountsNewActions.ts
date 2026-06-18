/** Actions for Chart of Accounts "New" dropdown (toolbar + page). */
export type ChartNewAction =
  | 'client'
  | 'supplier'
  | 'account:parent'
  | 'account:clientes'
  | 'account:fornecedores'
  | 'account:caixa'
  | 'account:bancos'
  | 'account:ativos'
  | 'account:recebimentos'
  | 'account:custos'
  | 'account:funcionarios'
  | 'account:capital'
  | 'account:todos';

export const CHART_NEW_ENTITY_ACTIONS: ChartNewAction[] = ['client', 'supplier'];

export const CHART_NEW_ACCOUNT_ACTIONS: ChartNewAction[] = [
  'account:parent',
  'account:clientes',
  'account:fornecedores',
  'account:caixa',
  'account:bancos',
  'account:ativos',
  'account:recebimentos',
  'account:custos',
  'account:funcionarios',
  'account:capital',
  'account:todos',
];

export function chartNewActionTab(action: ChartNewAction): string | null {
  if (!action.startsWith('account:')) return null;
  return action.slice('account:'.length);
}
