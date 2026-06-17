// AUTO-GENERATED from "PGC (novo com IVA).xlsx" — do not edit by hand.
// Angola Plano Geral de Contabilidade (Decreto n.º 82/2001). Codes use no-dot numbering
// (main = 11, first sub = 111). 294 accounts.

export type PgcSeedAccount = {
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  account_nature: 'debit' | 'credit';
  level: number;
  is_header: boolean;
  parent_code: string | null;
};

export const PGC_ACCOUNTS: PgcSeedAccount[] = [
  {
    "code": "11",
    "name": "IMOBILIZAÇÕES CORPÓREAS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "111",
    "name": "Terreno e recursos naturais",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "112",
    "name": "Edifícios e outras construções",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "113",
    "name": "Equipamento básico",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "114",
    "name": "Equipamento de carga e transporte",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "115",
    "name": "Equipamento administrativo",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "116",
    "name": "Taras e vasilhame",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "119",
    "name": "Outras imobilizações corpóreas",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "11"
  },
  {
    "code": "12",
    "name": "IMOBILIZAÇÕES INCORPÓREAS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "121",
    "name": "Trespasses",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "12"
  },
  {
    "code": "122",
    "name": "Despesas de investigação e desenvolvimento",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "12"
  },
  {
    "code": "123",
    "name": "Propriedade industrial e outros direitos e contratos",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "12"
  },
  {
    "code": "124",
    "name": "Despesas de constituição",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "12"
  },
  {
    "code": "129",
    "name": "Outras imobilizações incorpóreas",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "12"
  },
  {
    "code": "13",
    "name": "INVESTIMENTOS FINANCEIROS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "131",
    "name": "Empresas subsidiárias",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "13"
  },
  {
    "code": "132",
    "name": "Empresas associadas",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "13"
  },
  {
    "code": "133",
    "name": "Outras empresas",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "13"
  },
  {
    "code": "134",
    "name": "Investimentos em imóveis",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "13"
  },
  {
    "code": "135",
    "name": "Fundos",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "13"
  },
  {
    "code": "139",
    "name": "Outros investimentos financeiros",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "13"
  },
  {
    "code": "14",
    "name": "IMOBILIZAÇÕES EM CURSO",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "141",
    "name": "Obra em curso",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "14"
  },
  {
    "code": "142",
    "name": "Obra em curso",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "14"
  },
  {
    "code": "147",
    "name": "Adiantamentos por conta de imobilizado corpóreo",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "14"
  },
  {
    "code": "148",
    "name": "Adiantamentos por conta de imobilizado incorpóreo",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "14"
  },
  {
    "code": "149",
    "name": "Adiantamentos por conta de investimentos financeiros",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "14"
  },
  {
    "code": "18",
    "name": "AMORTIZAÇÕES ACUMULADAS",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "181",
    "name": "Imobilizações corpóreas",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "18"
  },
  {
    "code": "182",
    "name": "Imobilizações incorpóreas",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "18"
  },
  {
    "code": "183",
    "name": "Investimentos financeiros em imóveis",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "18"
  },
  {
    "code": "19",
    "name": "PROVISÕES PARA INVESTIMENTOS FINANCEIROS",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "191",
    "name": "Empresas subsidiárias",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "19"
  },
  {
    "code": "192",
    "name": "Empresas associadas",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "19"
  },
  {
    "code": "21",
    "name": "COMPRAS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "211",
    "name": "Matérias-primas, subsidiárias e de consumo",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "21"
  },
  {
    "code": "212",
    "name": "Mercadorias",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "21"
  },
  {
    "code": "217",
    "name": "Devoluções de compras",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "21"
  },
  {
    "code": "218",
    "name": "Descontos e abatimentos em compras",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "21"
  },
  {
    "code": "22",
    "name": "MATÉRIAS-PRIMAS, SUBSIDIÁRIAS E DE CONSUMO",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "23",
    "name": "PRODUTOS E TRABALHOS EM CURSO",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "24",
    "name": "PRODUTOS ACABADOS E INTERMÉDIOS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "25",
    "name": "SUBPRODUTOS, DESPERDÍCIOS, RESÍDUOS E REFUGOS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "251",
    "name": "Subprodutos",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "25"
  },
  {
    "code": "252",
    "name": "Desperdícios, resíduos e refugos",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "25"
  },
  {
    "code": "26",
    "name": "MERCADORIAS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "261",
    "name": "Mercadorias em armazém",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "26"
  },
  {
    "code": "27",
    "name": "MATÉRIAS, MERCADORIAS E OUTROS MATERIAIS EM TRÂNSITO",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "28",
    "name": "ADIANTAMENTOS POR CONTA DE COMPRAS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "281",
    "name": "Matérias-primas e outros materiais",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "28"
  },
  {
    "code": "282",
    "name": "Mercadorias",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "28"
  },
  {
    "code": "29",
    "name": "PROVISÃO PARA DEPRECIAÇÃO DE EXISTÊNCIAS",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "292",
    "name": "Matérias-primas, subsidiárias e de consumo",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "29"
  },
  {
    "code": "293",
    "name": "Produtos e trabalhos em curso",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "29"
  },
  {
    "code": "294",
    "name": "Produtos acabados e intermédios",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "29"
  },
  {
    "code": "295",
    "name": "Subprodutos, desperdícios, resíduos e refugos",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "29"
  },
  {
    "code": "296",
    "name": "Mercadorias",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "29"
  },
  {
    "code": "31",
    "name": "CLIENTES",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "311",
    "name": "Clientes - correntes",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "31"
  },
  {
    "code": "312",
    "name": "Clientes - títulos a receber",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "31"
  },
  {
    "code": "313",
    "name": "Clientes - títulos descontados",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "31"
  },
  {
    "code": "318",
    "name": "Clientes de cobrança duvidosa",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "31"
  },
  {
    "code": "319",
    "name": "Clientes - saldos credores",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "31"
  },
  {
    "code": "32",
    "name": "FORNECEDORES",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "321",
    "name": "Fornecedores - correntes",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "32"
  },
  {
    "code": "322",
    "name": "Fornecedores - títulos a pagar",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "32"
  },
  {
    "code": "328",
    "name": "Fornecedores - facturas em recepção e conferência",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "32"
  },
  {
    "code": "329",
    "name": "Fornecedores - saldos devedores",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "32"
  },
  {
    "code": "33",
    "name": "EMPRÉSTIMOS",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "331",
    "name": "Empréstimos bancários",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "33"
  },
  {
    "code": "332",
    "name": "Empréstimos por obrigações",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "33"
  },
  {
    "code": "333",
    "name": "Empréstimos por títulos de participação",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "33"
  },
  {
    "code": "339",
    "name": "Outros empréstimos obtidos",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "33"
  },
  {
    "code": "34",
    "name": "ESTADO",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "341",
    "name": "Imposto sobre os lucros",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "342",
    "name": "Imposto de produção e consumo",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "343",
    "name": "Imposto de rendimento de trabalho",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "344",
    "name": "Imposto de circulação",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "345",
    "name": "IVA",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": true,
    "parent_code": "34"
  },
  {
    "code": "3451",
    "name": "IVA dedutível",
    "account_type": "liability",
    "account_nature": "debit",
    "level": 3,
    "is_header": false,
    "parent_code": "345"
  },
  {
    "code": "3452",
    "name": "IVA liquidado",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 3,
    "is_header": false,
    "parent_code": "345"
  },
  {
    "code": "346",
    "name": "Certificado de crédito fiscal a compensar",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "348",
    "name": "Subsídios a preços",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "349",
    "name": "Outros impostos",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "34"
  },
  {
    "code": "35",
    "name": "ENTIDADES PARTICIPANTES E PARTICIPADAS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "351",
    "name": "Entidades participantes",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "35"
  },
  {
    "code": "36",
    "name": "PESSOAL",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "361",
    "name": "Pessoal - remunerações",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "36"
  },
  {
    "code": "362",
    "name": "Pessoal - participação nos resultados",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "36"
  },
  {
    "code": "363",
    "name": "Pessoal - adiantamentos",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "36"
  },
  {
    "code": "369",
    "name": "Pessoal - outros",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "36"
  },
  {
    "code": "37",
    "name": "OUTROS VALORES A RECEBER E A PAGAR",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "371",
    "name": "Compra de imobilizado",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "372",
    "name": "Vendas de imobilizado",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "373",
    "name": "Proveitos a facturar",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "374",
    "name": "Encargos a repartir por períodos futuros",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "375",
    "name": "Encargos a pagar",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "376",
    "name": "Proveitos a repartir por períodos futuros",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "377",
    "name": "Contas transitórias",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "379",
    "name": "Outros valores a receber e a pagar",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "37"
  },
  {
    "code": "38",
    "name": "PROVISÕES PARA COBRANÇAS DUVIDOSAS",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "381",
    "name": "Provisões para clientes",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "38"
  },
  {
    "code": "382",
    "name": "Provisões para saldos devedores de fornecedores",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "38"
  },
  {
    "code": "383",
    "name": "Provisões p/participantes e participadas",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "38"
  },
  {
    "code": "384",
    "name": "Provisões p/dívidas do pessoal",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "38"
  },
  {
    "code": "389",
    "name": "Provisões para outros saldos a receber",
    "account_type": "asset",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "38"
  },
  {
    "code": "39",
    "name": "PROVISÕES PARA OUTROS RISCOS E ENCARGOS",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "391",
    "name": "Provisões para pensões",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "39"
  },
  {
    "code": "392",
    "name": "Provisões para processos judiciais em curso",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "39"
  },
  {
    "code": "393",
    "name": "Provisões para acidentes de trabalho",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "39"
  },
  {
    "code": "394",
    "name": "Provisões para garantias dadas a clientes",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "39"
  },
  {
    "code": "399",
    "name": "Provisões para outros riscos e encargos",
    "account_type": "liability",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "39"
  },
  {
    "code": "41",
    "name": "TÍTULOS NEGOCIÁVEIS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "411",
    "name": "Acções",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "41"
  },
  {
    "code": "412",
    "name": "Obrigações",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "41"
  },
  {
    "code": "413",
    "name": "Títulos da dívida pública",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "41"
  },
  {
    "code": "42",
    "name": "DEPÓSITOS A PRAZO",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "421",
    "name": "Moeda nacional",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "42"
  },
  {
    "code": "422",
    "name": "Moeda estrangeira",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "42"
  },
  {
    "code": "43",
    "name": "DEPÓSITOS À ORDEM",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "431",
    "name": "Moeda nacional",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "43"
  },
  {
    "code": "432",
    "name": "Moeda estrangeira",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "43"
  },
  {
    "code": "44",
    "name": "OUTROS DEPÓSITOS",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "441",
    "name": "Moeda nacional",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "44"
  },
  {
    "code": "442",
    "name": "Moeda estrangeira",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "44"
  },
  {
    "code": "45",
    "name": "CAIXA",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "451",
    "name": "Fundo fixo",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "45"
  },
  {
    "code": "452",
    "name": "Valores para depositar",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "45"
  },
  {
    "code": "453",
    "name": "Valores destinados a pagamentos específicos",
    "account_type": "asset",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "45"
  },
  {
    "code": "51",
    "name": "CAPITAL",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "52",
    "name": "ACÇÕES/QUOTAS PRÓPRIAS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "521",
    "name": "Valor nominal",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "52"
  },
  {
    "code": "522",
    "name": "Descontos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "52"
  },
  {
    "code": "523",
    "name": "Prémios",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "52"
  },
  {
    "code": "53",
    "name": "PRÉMIOS DE EMISSÃO",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "54",
    "name": "PRESTAÇÕES SUPLEMENTARES",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "55",
    "name": "RESERVAS LEGAIS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "56",
    "name": "RESERVAS DE REAVALIAÇÃO",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "561",
    "name": "Legais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "56"
  },
  {
    "code": "562",
    "name": "Autónomas",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "56"
  },
  {
    "code": "57",
    "name": "RESERVAS COM FINS ESPECIAIS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "58",
    "name": "RESERVAS LIVRES",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "61",
    "name": "VENDAS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "611",
    "name": "Produtos acabados e intermédios",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "612",
    "name": "Subprodutos, desperdícios, resíduos e refugos",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "613",
    "name": "Mercadorias",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "614",
    "name": "Embalagens de consumo",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "615",
    "name": "Subsídios a preços",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "617",
    "name": "Devoluções",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "618",
    "name": "Descontos e abatimentos",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "619",
    "name": "Transferência para resultados operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "61"
  },
  {
    "code": "62",
    "name": "PRESTAÇÕES DE SERVIÇOS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "621",
    "name": "Serviços principais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "62"
  },
  {
    "code": "622",
    "name": "Serviços secundários",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "62"
  },
  {
    "code": "628",
    "name": "Descontos e abatimentos",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "62"
  },
  {
    "code": "629",
    "name": "Transferência para resultados operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "62"
  },
  {
    "code": "63",
    "name": "OUTROS PROVEITOS OPERACIONAIS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "631",
    "name": "Serviços suplementares",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "632",
    "name": "Royalties",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "633",
    "name": "Subsídios à exploração",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "634",
    "name": "Subsídios à investimento",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "635",
    "name": "IVA",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "638",
    "name": "Outros proveitos e ganhos operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "639",
    "name": "Transferência para resultados operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "63"
  },
  {
    "code": "64",
    "name": "VARIAÇÃO NOS INVENTÁRIOS DE PRODUTOS ACABADOS E DE PRODUÇÃO EM CURSO",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "641",
    "name": "Produtos e trabalhos em curso",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "64"
  },
  {
    "code": "642",
    "name": "Produtos acabados",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "64"
  },
  {
    "code": "643",
    "name": "Produtos intermédios",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "64"
  },
  {
    "code": "649",
    "name": "Transferência para resultados operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "64"
  },
  {
    "code": "65",
    "name": "TRABALHOS PARA A PRÓPRIA EMPRESA",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "651",
    "name": "Para imobilizado",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "65"
  },
  {
    "code": "652",
    "name": "Para encargos a repartir por exercícios futuros",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "65"
  },
  {
    "code": "659",
    "name": "Transferência para resultados operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "65"
  },
  {
    "code": "66",
    "name": "PROVEITOS E GANHOS FINANCEIROS GERAIS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "661",
    "name": "Juros",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "662",
    "name": "Diferenças de câmbio favoráveis",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "663",
    "name": "Descontos de pronto pagamento obtidos",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "664",
    "name": "Rendimentos de investimentos em imóveis",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "665",
    "name": "Rendimento de participações de capital",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "666",
    "name": "Ganhos na alienação de aplicações financeiras",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "667",
    "name": "Redução de provisões",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "66"
  },
  {
    "code": "67",
    "name": "PROVEITOS E GANHOS FINANCEIROS EM SUBSIDIÁRIAS E ASSOCIADAS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "671",
    "name": "Rendimento de participações de capital",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "67"
  },
  {
    "code": "679",
    "name": "Transferência para resultados em filiais e associadas",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "67"
  },
  {
    "code": "68",
    "name": "OUTROS PROVEITOS E GANHOS NÃO OPERACIONAIS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "681",
    "name": "Redução de provisões",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "6810",
    "name": "Correcções relativas a exercícios anteriores",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "6811",
    "name": "Outros ganhos e perdas não operacionais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "682",
    "name": "Anulação de amortizações extraordinárias",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "684",
    "name": "Ganhos em existências",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "685",
    "name": "Recuperação de dívidas",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "686",
    "name": "Benefícios de penalidades contratuais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "688",
    "name": "Descontinuidade de operações",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "689",
    "name": "Alterações de políticas contabilísticas",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "68"
  },
  {
    "code": "69",
    "name": "PROVEITOS E GANHOS EXTRAORDINÁRIOS",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "691",
    "name": "Ganhos resultantes de catástrofes naturais",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "692",
    "name": "Ganhos resultantes de convulsões políticas",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "693",
    "name": "Ganhos resultantes de expropriações",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "694",
    "name": "Ganhos resultantes de sinistros",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "695",
    "name": "Subsídios",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "696",
    "name": "Anulação de passivos não exigível",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "699",
    "name": "Transferência para resultados extraordinários",
    "account_type": "revenue",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "69"
  },
  {
    "code": "71",
    "name": "CUSTO DAS EXISTÊNCIAS VENDIDAS",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "711",
    "name": "Custo das mercadorias vendidas",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "71"
  },
  {
    "code": "72",
    "name": "CUSTOS COM O PESSOAL",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "721",
    "name": "Remunerações - Órgãos sociais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "72"
  },
  {
    "code": "722",
    "name": "Remunerações - Pessoal",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "72"
  },
  {
    "code": "723",
    "name": "Pensões",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "72"
  },
  {
    "code": "724",
    "name": "Prémios para pensões",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "72"
  },
  {
    "code": "73",
    "name": "AMORTIZAÇÕES DO EXERCÍCIO",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "731",
    "name": "Imobilizações corpóreas",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "73"
  },
  {
    "code": "732",
    "name": "Imobilizações incorpóreas",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "73"
  },
  {
    "code": "739",
    "name": "Transferência para resultados operacionais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "73"
  },
  {
    "code": "75",
    "name": "OUTROS CUSTOS E PERDAS OPERACIONAIS",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "751",
    "name": "Subcontratos",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "752",
    "name": "Fornecimentos e serviços de terceiros",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "753",
    "name": "Impostos",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "754",
    "name": "Despesas confidenciais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "755",
    "name": "Quotizações",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "756",
    "name": "Ofertas e amostras de existências",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "758",
    "name": "Outros custos e perdas operacionais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "759",
    "name": "Transferência para resultados operacionais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "75"
  },
  {
    "code": "76",
    "name": "CUSTOS E PERDAS FINANCEIROS GERAIS",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "761",
    "name": "Juros",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "76"
  },
  {
    "code": "762",
    "name": "Diferenças de câmbio desfavoráveis",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "76"
  },
  {
    "code": "766",
    "name": "Perdas na alienação de aplicações financeiras",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "76"
  },
  {
    "code": "767",
    "name": "Serviços bancários",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "76"
  },
  {
    "code": "769",
    "name": "Transferência para resultados financeiros",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "76"
  },
  {
    "code": "77",
    "name": "CUSTOS E PERDAS FINANCEIROS EM FILIAIS E ASSOCIADAS",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "779",
    "name": "Transferência para resultados financeiros",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "77"
  },
  {
    "code": "78",
    "name": "OUTROS CUSTOS E PERDAS NÃO OPERACIONAIS",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "781",
    "name": "Provisões do exercício",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "7810",
    "name": "Correcções relativas a exercícios anteriores",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "7811",
    "name": "Outros custos e perdas não operacionais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "7819",
    "name": "Transferência para resultados não operacionais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "782",
    "name": "Amortizações extraordinárias",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "783",
    "name": "Perdas em imobilizações",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "784",
    "name": "Perdas em existências",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "785",
    "name": "Dívidas incobráveis",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "786",
    "name": "Multas e penalidades contratuais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "787",
    "name": "Custo de reestruturação",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "788",
    "name": "Descontinuidade de operações",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "789",
    "name": "Alterações de políticas contabilísticas",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "78"
  },
  {
    "code": "79",
    "name": "CUSTOS E PERDAS EXTRAORDINÁRIOS",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "791",
    "name": "Perdas resultantes de catástrofes naturais",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "79"
  },
  {
    "code": "792",
    "name": "Perdas resultantes de convulsões políticas",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "79"
  },
  {
    "code": "793",
    "name": "Perdas resultantes de expropriações",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "79"
  },
  {
    "code": "794",
    "name": "Perdas resultantes de sinistros",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "79"
  },
  {
    "code": "799",
    "name": "Transferência para resultados extraordinários",
    "account_type": "expense",
    "account_nature": "debit",
    "level": 2,
    "is_header": false,
    "parent_code": "79"
  },
  {
    "code": "81",
    "name": "RESULTADOS TRANSITADOS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "811",
    "name": "Ano",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "81"
  },
  {
    "code": "812",
    "name": "Ano",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "81"
  },
  {
    "code": "82",
    "name": "RESULTADOS OPERACIONAIS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "821",
    "name": "Vendas",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "8219",
    "name": "Transferência para resultados líquidos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "822",
    "name": "Prestações de serviços",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "823",
    "name": "Outros proveitos operacionais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "824",
    "name": "Variação nos inventários de produtos acabados e produtos em vias de fabrico",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "825",
    "name": "Trabalhos para a própria empresa",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "826",
    "name": "Custo das mercadorias vendidas e das matérias consumidas",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "827",
    "name": "Custos com o pessoal",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "828",
    "name": "Amortizações do exercício",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "829",
    "name": "Outros custos operacionais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "82"
  },
  {
    "code": "83",
    "name": "RESULTADOS FINANCEIROS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "831",
    "name": "Proveitos e ganhos financeiros gerais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "83"
  },
  {
    "code": "832",
    "name": "Custos e perdas financeiros gerais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "83"
  },
  {
    "code": "839",
    "name": "Transferência para resultados líquidos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "83"
  },
  {
    "code": "84",
    "name": "RESULTADOS FINANCEIROS EM FILIAIS E ASSOCIADAS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "841",
    "name": "Proveitos e ganhos em filiais e associadas",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "84"
  },
  {
    "code": "842",
    "name": "Custos e perdas em filiais e associadas",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "84"
  },
  {
    "code": "849",
    "name": "Transferência para resultados líquidos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "84"
  },
  {
    "code": "85",
    "name": "RESULTADOS NÃO OPERACIONAIS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "851",
    "name": "Proveitos e ganhos não operacionais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "85"
  },
  {
    "code": "852",
    "name": "Custos e perdas não operacionais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "85"
  },
  {
    "code": "859",
    "name": "Transferência para resultados líquidos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "85"
  },
  {
    "code": "86",
    "name": "RESULTADOS EXTRAORDINÁRIOS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "861",
    "name": "Proveitos e ganhos extraordinários",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "86"
  },
  {
    "code": "862",
    "name": "Custos e perdas extraordinários",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "86"
  },
  {
    "code": "869",
    "name": "Transferência para resultados líquidos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "86"
  },
  {
    "code": "87",
    "name": "IMPOSTOS SOBRE OS LUCROS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "871",
    "name": "Imposto sobre os resultados correntes",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "87"
  },
  {
    "code": "872",
    "name": "Imposto sobre os resultados extraordinários",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "87"
  },
  {
    "code": "879",
    "name": "Transferência para resultados líquidos",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "87"
  },
  {
    "code": "88",
    "name": "RESULTADO LÍQUIDO DO EXERCÍCIO",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "881",
    "name": "Resultados operacionais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "882",
    "name": "Resultados financeiros gerais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "883",
    "name": "Resultados em filiais e associadas",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "884",
    "name": "Resultados não operacionais",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "885",
    "name": "Imposto sobre os resultados correntes",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "886",
    "name": "Resultados extraordinários",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "887",
    "name": "Imposto sobre os resultados extraordinários",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "889",
    "name": "Transferência para resultados transitados",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "88"
  },
  {
    "code": "89",
    "name": "DIVIDENDOS ANTECIPADOS",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 1,
    "is_header": true,
    "parent_code": null
  },
  {
    "code": "899",
    "name": "Transferência para resultados transitados",
    "account_type": "equity",
    "account_nature": "credit",
    "level": 2,
    "is_header": false,
    "parent_code": "89"
  }
];
