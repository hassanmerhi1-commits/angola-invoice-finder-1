import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");

// Audit only UI-facing code, not storage/libs/types.
const INCLUDE_PREFIXES = [
  "src/pages/",
  "src/components/",
  "src/hooks/",
];
const EXT_OK = new Set([".ts", ".tsx"]);

// Rough Portuguese heuristic: accented characters OR common PT words.
const PT_HINT = /[áàãâçéêíóôõúÁÀÃÂÇÉÊÍÓÔÕÚ]|\b(Guardar|Cancelar|Eliminar|Editar|Adicionar|Pesquisar|Factura|Fatura|Recibo|Pagamento|Cliente|Fornecedor|Relatório|Inventário|Caixa|Despesas|Definições|Sede|Filial|Vendas|Compras|Utilizador|Senha|Entrar|Sair|Novo|Nenhum|Seleccione|Selecionar|Seleccionar)\b/i;

function isUnderAllowedDir(filePath) {
  const rel = path.relative(process.cwd(), filePath).replaceAll("\\", "/");
  return rel === "src" || rel.startsWith("src/");
}

function shouldIncludeFile(rel) {
  if (rel.startsWith("src/i18n/translations/")) return false;
  // Setup contains municipality/province proper nouns; those shouldn't be forced to translate.
  if (rel === "src/pages/Setup.tsx") return true; // keep included; we’ll ignore the location map block below
  return INCLUDE_PREFIXES.some((p) => rel.startsWith(p));
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      out.push(...(await walk(full)));
    } else {
      const ext = path.extname(ent.name);
      if (EXT_OK.has(ext)) out.push(full);
    }
  }
  return out;
}

function extractStringLiterals(code) {
  // Intentionally simple (fast heuristic, not a full parser).
  // Captures "..." and '...' (ignores template literals).
  const strings = [];
  const re = /(["'])(?:(?=(\\?))\2.)*?\1/g;
  let m;
  while ((m = re.exec(code))) {
    strings.push({ raw: m[0], index: m.index });
  }
  return strings;
}

function lineOf(code, idx) {
  // 1-based line number
  return code.slice(0, idx).split("\n").length;
}

const skipIfLooksLikeKey = (s) => {
  // ignore translation object keys like "dashboard:" etc
  // only skip very short tokens and things that look like identifiers
  const unq = s.slice(1, -1);
  if (unq.length <= 2) return true;
  if (/^[a-zA-Z0-9_./:-]+$/.test(unq)) return true;
  return false;
};

function shouldIgnoreLiteral(rel, raw) {
  // Allowlisted non-UI literals that must remain Portuguese for compatibility.
  if (rel === "src/pages/BankReconciliation.tsx") {
    // Bank statement import column headers (Portuguese) — not UI strings.
    const unq = raw.slice(1, -1);
    if (
      unq === "Descrição" ||
      unq === "Referência" ||
      unq === "Crédito" ||
      unq === "Débito" ||
      unq === "description/Descrição"
    ) {
      return true;
    }
  }
  return false;
}

async function main() {
  if (!isUnderAllowedDir(ROOT)) {
    console.error(`[i18n-audit] Expected src/ at ${ROOT}`);
    process.exit(2);
  }

  const files = await walk(ROOT);
  const findings = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
    if (!shouldIncludeFile(rel)) continue;

    const code = await readFile(file, "utf8");

    // Ignore Angola municipality/province data (proper nouns) in Setup.
    const codeForScan =
      rel === "src/pages/Setup.tsx"
        ? code.replace(/const\s+ANGOLA_LOCATION_MAP[\s\S]*?;\s*\n/gm, "const ANGOLA_LOCATION_MAP = {};\n")
        : code;

    for (const s of extractStringLiterals(codeForScan)) {
      const raw = s.raw;
      if (skipIfLooksLikeKey(raw)) continue;
      if (shouldIgnoreLiteral(rel, raw)) continue;
      if (!PT_HINT.test(raw)) continue;
      findings.push({
        file: rel,
        line: lineOf(codeForScan, s.index),
        text: raw.length > 140 ? raw.slice(0, 140) + "…" : raw,
      });
    }
  }

  // Print grouped output
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  if (findings.length === 0) {
    console.log("[i18n-audit] OK: no suspicious hardcoded Portuguese strings found in src/ (excluding translations).");
    return;
  }

  console.log(`[i18n-audit] Found ${findings.length} suspicious hardcoded strings:\n`);
  let current = "";
  for (const f of findings) {
    if (f.file !== current) {
      current = f.file;
      console.log(`- ${current}`);
    }
    console.log(`  L${f.line}: ${f.text}`);
  }

  process.exitCode = 1;
}

main().catch((e) => {
  console.error("[i18n-audit] Failed:", e);
  process.exit(2);
});

