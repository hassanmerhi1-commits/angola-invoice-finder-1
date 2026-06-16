import {
  Plus,
  Users,
  Truck,
  ChevronDown,
  Wallet,
  Landmark,
  Package,
  TrendingUp,
  Receipt,
  UserCog,
  Scale,
  List,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import {
  CHART_NEW_ACCOUNT_ACTIONS,
  CHART_NEW_ENTITY_ACTIONS,
  type ChartNewAction,
} from '@/lib/chartOfAccountsNewActions';
import { dispatchChartNew } from '@/lib/nexorToolbarEvents';

const ENTITY_ICONS: Record<string, LucideIcon> = {
  client: Users,
  supplier: Truck,
};

const ACCOUNT_TAB_ICONS: Record<string, LucideIcon> = {
  clientes: Users,
  fornecedores: Truck,
  caixa: Wallet,
  bancos: Landmark,
  ativos: Package,
  recebimentos: TrendingUp,
  custos: Receipt,
  funcionarios: UserCog,
  capital: Scale,
  todos: List,
};

const ACCOUNT_LABEL_KEYS: Record<string, keyof ReturnType<typeof useTranslation>['t']['chartOfAccountsUi']> = {
  clientes: 'newCustomerAccount',
  fornecedores: 'newSupplierAccount',
  caixa: 'newCashAccount',
  bancos: 'newBankAccount',
  ativos: 'newAssetAccount',
  recebimentos: 'newRevenueAccount',
  custos: 'newExpenseAccount',
  funcionarios: 'newEmployeeAccount',
  capital: 'newEquityAccount',
  todos: 'newAccount',
};

type ChartOfAccountsNewMenuProps = {
  buttonClassName?: string;
};

export function ChartOfAccountsNewMenu({ buttonClassName }: ChartOfAccountsNewMenuProps) {
  const { t } = useTranslation();
  const ui = t.chartOfAccountsUi;

  const entityLabels: Record<string, string> = {
    client: t.clientsUi.newClient,
    supplier: t.suppliersUi.newSupplierCta,
  };

  const renderAccountItem = (action: ChartNewAction) => {
    const tab = action.slice('account:'.length);
    const Icon = ACCOUNT_TAB_ICONS[tab] || Plus;
    const labelKey = ACCOUNT_LABEL_KEYS[tab];
    const label = labelKey ? (ui[labelKey] as string) : ui.newAccount;
    return (
      <DropdownMenuItem key={action} onClick={() => dispatchChartNew(action)}>
        <Icon className="w-3 h-3 mr-2" />
        {label}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={buttonClassName}>
          <Plus className="w-3 h-3" /> {ui.newMenu} <ChevronDown className="w-3 h-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(70vh,28rem)] overflow-y-auto">
        {CHART_NEW_ENTITY_ACTIONS.map((action) => {
          const Icon = ENTITY_ICONS[action] || Plus;
          return (
            <DropdownMenuItem key={action} onClick={() => dispatchChartNew(action)}>
              <Icon className="w-3 h-3 mr-2" />
              {entityLabels[action]}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {CHART_NEW_ACCOUNT_ACTIONS.map(renderAccountItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
