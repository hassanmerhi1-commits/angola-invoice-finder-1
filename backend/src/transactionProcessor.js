const db = require('./db');
const { randomUUID } = require('crypto');
const {
  recordStockMovement,
  resolveStockEntryDirection,
  createOpenItem,
  reduceSupplierInvoiceOpenItem,
  adoptPurchaseOrderOpenItemForInvoice,
  syncSupplierBalanceFromOpenItems,
  isOpenItemDebitFlag,
  linkDocuments,
  validatePeriod,
  auditLog,
  applyPurchaseSupplierToProducts,
} = require('./transactionEngine');
const { isUniqueSkuBranchError } = require('./lib/productSkuResolve');
const { coalesceActiveNotZero } = require('./lib/sqlDialect');
const {
  createJournalEntry,
} = require('./accounting');

async function ensureFreightExpenseAccount(client) {
  const existing = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '752' AND is_active = true LIMIT 1`
  );

  if (existing.rows.length > 0) return;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '75' AND is_active = true LIMIT 1`
  );

  if (parentResult.rows.length === 0) {
    throw new Error('Conta 75 não encontrada para lançar frete');
  }

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, '752', 'Fornecimentos e serviços de terceiros', 'expense', 'debit', $2, 2, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), parentResult.rows[0].id]
  );
}

async function ensureJournalLineAccounts(client, journalLines = [], entityBalanceUpdate = null, openItem = null) {
  // Angola PGC (novo com IVA): dynamic sub-accounts live under 321 (suppliers) and 311 (clients).
  const configs = [
    { pattern: /^321\d+$/i, parentCode: '321', accountType: 'liability', accountNature: 'credit' },
    { pattern: /^311\d+$/i, parentCode: '311', accountType: 'asset', accountNature: 'debit' },
  ];

  for (const line of journalLines) {
    const code = String(line.accountCode || '').trim();
    if (!code) continue;

    const existing = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [code],
    );
    if (existing.rows.length > 0) continue;

    const cfg = configs.find((c) => c.pattern.test(code));
    if (!cfg) {
      throw new Error(`Conta contabilística não encontrada: ${code}`);
    }

    const parent = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [cfg.parentCode],
    );
    if (parent.rows.length === 0) {
      throw new Error(`Conta pai ${cfg.parentCode} não encontrada para criar ${code}`);
    }

    const accountName =
      String(line.accountName || '').trim()
      || String(line.note || '').trim()
      || String(entityBalanceUpdate?.entityName || '').trim()
      || String(openItem?.entityName || '').trim()
      || code;

    await client.query(
      `INSERT INTO chart_of_accounts
       (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
       VALUES ($1, $2, $3, '', $4, $5, $6, 3, false, true, 0, 0)`,
      [randomUUID(), code, accountName, cfg.accountType, cfg.accountNature, parent.rows[0].id],
    );
  }
}

async function ensureSupplierJournalAccounts(client, journalLines = [], entityBalanceUpdate = null, openItem = null) {
  const supplierLines = journalLines.filter((line) => /^321\d+$/i.test(String(line.accountCode || '').trim()));
  if (supplierLines.length === 0) return;

  const parent = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '321' AND is_active = true LIMIT 1`
  );
  if (parent.rows.length === 0) {
    throw new Error('Conta 321 não encontrada para lançar fornecedor');
  }

  const parentId = parent.rows[0].id;
  for (const line of supplierLines) {
    const code = String(line.accountCode || '').trim();
    const existing = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [code]
    );
    if (existing.rows.length > 0) continue;

    const supplierName =
      String(line.accountName || '').trim()
      || String(entityBalanceUpdate?.entityName || '').trim()
      || String(openItem?.entityName || '').trim()
      || `Fornecedor ${code}`;
    const supplierNif = String(entityBalanceUpdate?.entityNif || '').trim();

    await client.query(
      `INSERT INTO chart_of_accounts
       (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
       VALUES ($1, $2, $3, $4, 'liability', 'credit', $5, 3, false, true, 0, 0)
       ON CONFLICT (code) DO NOTHING`,
      [randomUUID(), code, supplierName, supplierNif ? `NIF: ${supplierNif}` : '', parentId]
    );
  }

  await client.query(
    `UPDATE chart_of_accounts SET children_count = (
       SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
     ) WHERE id = $1`,
    [parentId]
  );
}

async function processTransactionBody(client, body) {
      const {
        transactionType, documentId, documentNumber, branchId,
        userId, date, description, amount, currency,
        stockEntries, journalLines, openItem, documentLinks,
        priceUpdates, entityBalanceUpdate,
        taxLines, linkedPurchaseOrderNumber, changePrice,
      } = body;
      const applySellingPrice = changePrice === true || changePrice === 'true' || changePrice === 1;

      const effectivePriceUpdates = new Map(
        (priceUpdates || []).map((pu) => [pu.productId, Number(pu.newUnitCost || 0)])
      );

      // Input validation
      if (!branchId) throw new Error('branchId é obrigatório');
      if (!transactionType) throw new Error('transactionType é obrigatório');

      const result = {
        success: false,
        stockMovementIds: [],
        journalEntryId: null,
        openItemId: null,
        documentLinkIds: [],
        /** Catalog line productId → branch products.id used for stock/cost (when cloned). */
        resolvedProductIds: {},
        errors: [],
      };

      // Validate period
      await validatePeriod(client, date || new Date().toISOString());

      // Idempotency: safe to retry save when stock was already posted for this document.
      if (documentId) {
        const existingStock = await client.query(
          `SELECT id FROM stock_movements
           WHERE reference_id = $1
             AND reference_type IN ('purchase_invoice', 'purchase', 'sale', 'transfer', 'adjustment', 'credit_note')
           ORDER BY created_at`,
          [documentId],
        );
        if (existingStock.rows.length > 0) {
          const journalRow = await client.query(
            'SELECT id FROM journal_entries WHERE reference_id = $1 LIMIT 1',
            [documentId],
          );
          const openItemRow = await client.query(
            'SELECT id FROM open_items WHERE document_id = $1 LIMIT 1',
            [documentId],
          );
          const skipped = {
            success: true,
            stockMovementIds: existingStock.rows.map((r) => r.id),
            journalEntryId: journalRow.rows[0]?.id || null,
            openItemId: openItemRow.rows[0]?.id || null,
            documentLinkIds: [],
            resolvedProductIds: {},
            alreadyProcessed: true,
          };
          console.log(
            `[TX API] ${transactionType} ${documentNumber}: already processed (idempotent skip)`,
          );
          return skipped;
        }
      }

      // Phase 1: Stock Movements (through engine)
      /** Line productId → actual products.id used after branch clone (shared catalog → filial row). */
      const stockProductIdByLine = new Map();
      if (stockEntries && stockEntries.length > 0) {
        for (const entry of stockEntries) {
          const effectiveUnitCost = effectivePriceUpdates.get(entry.productId) ?? entry.unitCost ?? 0;

          if (transactionType === 'purchase_invoice' && Number(effectiveUnitCost) !== Number(entry.unitCost || 0)) {
            console.log(
              `[TX API] purchase_invoice ${documentNumber}: landed cost applied for ${entry.productId} ` +
              `base=${Number(entry.unitCost || 0)} final=${Number(effectiveUnitCost)}`
            );
          }

          const stockDirection = resolveStockEntryDirection(entry, transactionType, openItem);
          const stockReferenceType =
            transactionType === 'credit_note' && openItem?.entityType === 'supplier'
              ? 'supplier_return'
              : transactionType;

          const movement = await recordStockMovement(client, {
            productId: entry.productId,
            warehouseId: entry.warehouseId,
            movementType: stockDirection,
            quantity: entry.quantity,
            unitCost: effectiveUnitCost,
            referenceType: stockReferenceType,
            referenceId: documentId,
            referenceNumber: documentNumber,
            createdBy: userId,
          });
          result.stockMovementIds.push(movement.id);
          const resolvedPid = movement.product_id || entry.productId;
          stockProductIdByLine.set(entry.productId, resolvedPid);
          if (resolvedPid !== entry.productId) {
            console.log(
              `[TX API] ${transactionType} ${documentNumber}: stock on filial product ${resolvedPid} ` +
              `(line had ${entry.productId})`
            );
          }
        }
        if (stockProductIdByLine.size > 0) {
          result.resolvedProductIds = Object.fromEntries(stockProductIdByLine);
        }
      }

      // Phase 2: Price Updates (WAC) — same product row that received stock
      if (priceUpdates && priceUpdates.length > 0) {
        for (const pu of priceUpdates) {
          const targetProductId = stockProductIdByLine.get(pu.productId) || pu.productId;
          const prodResult = await client.query(
            'SELECT stock, cost FROM products WHERE id = $1 FOR UPDATE',
            [targetProductId]
          );
          if (prodResult.rows.length > 0) {
            const p = prodResult.rows[0];
            const currentStock = parseInt(p.stock) || 0;
            const currentCost = parseFloat(p.cost) || 0;
            const previousStock = Math.max(currentStock - pu.quantityReceived, 0);
            const prevTotal = previousStock * currentCost;
            const newTotal = pu.quantityReceived * pu.newUnitCost;
            const totalStock = previousStock + pu.quantityReceived;
            const newAvg = totalStock > 0 ? (prevTotal + newTotal) / totalStock : pu.newUnitCost;

            const nextAvgCost = Number(newAvg.toFixed(2));
            const nextLastCost = Number(Number(pu.newUnitCost || 0).toFixed(2));

            await client.query(
              `UPDATE products
               SET cost = $1,
                   last_cost = $2,
                   avg_cost = $1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3`,
              [nextAvgCost, nextLastCost, targetProductId]
            );

            const skuRow = await client.query(
              'SELECT sku FROM products WHERE id = $1',
              [targetProductId],
            );
            const skuKey = String(skuRow.rows[0]?.sku || '').trim();
            if (skuKey) {
              await client.query(
                `UPDATE products
                 SET cost = $1, last_cost = $2, avg_cost = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE ${coalesceActiveNotZero(db, 'is_active')}
                   AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($3)`,
                [nextAvgCost, nextLastCost, skuKey],
              );
            }

            const selling = pu.sellingPrice != null && pu.sellingPrice !== ''
              ? Number(pu.sellingPrice)
              : null;
            const shouldApplySelling =
              selling != null && !Number.isNaN(selling) && selling > 0
              && (applySellingPrice || selling > 0);
            if (shouldApplySelling) {
              await client.query(
                `UPDATE products
                 SET price = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [selling, targetProductId],
              );
              if (skuKey) {
                await client.query(
                  `UPDATE products
                   SET price = $1, updated_at = CURRENT_TIMESTAMP
                   WHERE ${coalesceActiveNotZero(db, 'is_active')}
                     AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($2)`,
                  [selling, skuKey],
                );
              }
              console.log(
                `[TX API] selling price ${transactionType} ${documentNumber}: product=${targetProductId} price=${selling}`,
              );
            }

            console.log(
              `[TX API] price update ${transactionType} ${documentNumber}: product=${targetProductId} ` +
              `prevStock=${previousStock} received=${pu.quantityReceived} avgCost=${nextAvgCost} lastCost=${nextLastCost}`
            );
          }
        }
      }

      // Phase 2.5: Link supplier to purchased products (inventory grid)
      if (transactionType === 'purchase_invoice' && openItem?.entityType === 'supplier') {
        const productIds = [...stockProductIdByLine.values()];
        const skuKeys = (stockEntries || [])
          .map((e) => String(e.productSku || e.product_sku || '').trim())
          .filter(Boolean);
        await applyPurchaseSupplierToProducts(client, {
          supplierId: openItem.entityId,
          supplierName: openItem.entityName,
          productIds,
          skuKeys,
        });
      }

      // Phase 3: Journal Entry (through accounting engine — validates balance)
      if (journalLines && journalLines.length > 0) {
        if (journalLines.some((line) => line.accountCode === '752')) {
          await ensureFreightExpenseAccount(client);
        }
        await ensureJournalLineAccounts(client, journalLines, entityBalanceUpdate, openItem);
        await ensureSupplierJournalAccounts(client, journalLines, entityBalanceUpdate, openItem);

        const entry = await createJournalEntry(client, {
          description,
          referenceType: transactionType,
          referenceId: documentId,
          branchId,
          createdBy: userId,
          lines: journalLines.map(l => ({
            accountCode: l.accountCode,
            description: l.note || description,
            debit: l.debit || 0,
            credit: l.credit || 0,
          })),
        });
        result.journalEntryId = entry.id;
      }

      // Phase 3.5: Tax Engine (IVA / Retenção / IS)
      if (Array.isArray(taxLines) && taxLines.length > 0) {
        const d = new Date(date || new Date().toISOString());
        const periodYear = d.getFullYear();
        const periodMonth = d.getMonth() + 1;

        // Ensure idempotency for retries
        await client.query('DELETE FROM tax_lines WHERE document_type = $1 AND document_id = $2', [transactionType, documentId]);
        await client.query('DELETE FROM tax_summaries WHERE document_type = $1 AND document_id = $2', [transactionType, documentId]);

        for (const tl of taxLines) {
          const taxCode = String(tl.taxCode || '').trim();
          const taxRate = Number(tl.taxRate || 0);
          const baseAmount = Number(tl.baseAmount || 0);
          const taxAmount = Number(tl.taxAmount || 0);
          const lineNumber = Number(tl.lineNumber || 1);
          const isInclusive = !!tl.isInclusive;

          if (!taxCode || !isFinite(baseAmount) || !isFinite(taxAmount)) continue;

          let taxCodeId = null;
          try {
            const tc = await client.query('SELECT id FROM tax_codes WHERE code = $1 LIMIT 1', [taxCode]);
            taxCodeId = tc.rows[0]?.id || null;
          } catch {
            taxCodeId = null;
          }

          await client.query(
            `INSERT INTO tax_lines
             (document_type, document_id, line_number, tax_code_id, tax_code, tax_rate, base_amount, tax_amount, is_inclusive)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [transactionType, documentId, lineNumber, taxCodeId, taxCode, taxRate, baseAmount, taxAmount, isInclusive]
          );
        }

        // Create document-level summaries (grouped by tax code/rate)
        const summaryRows = await client.query(
          `SELECT tax_code, tax_rate,
                  SUM(base_amount) AS total_base,
                  SUM(tax_amount) AS total_tax
           FROM tax_lines
           WHERE document_type = $1 AND document_id = $2
           GROUP BY tax_code, tax_rate`,
          [transactionType, documentId]
        );

        const direction = transactionType === 'sale' ? 'output' : 'input';
        for (const row of summaryRows.rows) {
          await client.query(
            `INSERT INTO tax_summaries
             (document_type, document_id, tax_code, tax_rate, total_base, total_tax, direction, period_year, period_month)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              transactionType,
              documentId,
              row.tax_code,
              Number(row.tax_rate || 0),
              Number(row.total_base || 0),
              Number(row.total_tax || 0),
              direction,
              periodYear,
              periodMonth,
            ]
          );
        }
      }

      // Phase 4: Open Item (through engine)
      if (openItem) {
        const invoiceLink = (documentLinks || []).find((dl) =>
          ['fatura_compra', 'purchase_invoice'].includes(String(dl.targetType || ''))
        );
        const isLinkedSupplierReturn =
          transactionType === 'credit_note' &&
          openItem.entityType === 'supplier' &&
          !isOpenItemDebitFlag(openItem.isDebit) &&
          !!invoiceLink;

        if (isLinkedSupplierReturn) {
          const applied = await reduceSupplierInvoiceOpenItem(client, {
            entityId: openItem.entityId,
            invoiceDocumentId: invoiceLink.targetId,
            amount: openItem.originalAmount,
          });
          if (applied) {
            result.openItemId = applied.id;
            openItem.entityId = applied.entityId || openItem.entityId;
            if (entityBalanceUpdate && entityBalanceUpdate.entityType === 'supplier') {
              entityBalanceUpdate.entityId = applied.entityId || entityBalanceUpdate.entityId;
            }
            console.log(
              `[TX API] Supplier return ${documentNumber}: reduced invoice ${applied.documentNumber} open item by ${applied.applied}`
            );
          } else {
            const oi = await createOpenItem(client, {
              entityType: openItem.entityType,
              entityId: openItem.entityId,
              documentType: openItem.documentType,
              documentId,
              documentNumber,
              documentDate: date || new Date().toISOString().split('T')[0],
              dueDate: openItem.dueDate || null,
              originalAmount: openItem.originalAmount,
              isDebit: openItem.isDebit,
              branchId,
              currency: openItem.currency || currency || 'AOA',
            });
            result.openItemId = oi.id;
            console.warn(
              `[TX API] Supplier return ${documentNumber}: invoice open item not found — created standalone credit open item`
            );
          }
        } else {
          let oi = null;
          if (transactionType === 'purchase_invoice') {
            const adopted = await adoptPurchaseOrderOpenItemForInvoice(client, {
              entityId: openItem.entityId,
              invoiceDocumentId: documentId,
              invoiceDocumentNumber: documentNumber,
              invoiceDocumentDate: date || new Date().toISOString().split('T')[0],
              originalAmount: openItem.originalAmount,
              dueDate: openItem.dueDate || null,
              currency: openItem.currency || currency || 'AOA',
              branchId,
              purchaseOrderNumber: linkedPurchaseOrderNumber,
            });
            if (adopted) {
              result.openItemId = adopted.id;
              openItem.entityId = adopted.entityId || openItem.entityId;
              if (entityBalanceUpdate && entityBalanceUpdate.entityType === 'supplier') {
                entityBalanceUpdate.entityId = adopted.entityId || entityBalanceUpdate.entityId;
              }
            }
          }
          if (!result.openItemId) {
            oi = await createOpenItem(client, {
              entityType: openItem.entityType,
              entityId: openItem.entityId,
              documentType: openItem.documentType,
              documentId,
              documentNumber,
              documentDate: date || new Date().toISOString().split('T')[0],
              dueDate: openItem.dueDate || null,
              originalAmount: openItem.originalAmount,
              isDebit: openItem.isDebit,
              branchId,
              currency: openItem.currency || currency || 'AOA',
            });
            result.openItemId = oi.id;
          }
        }
      }

      // Phase 5: Document Links (through engine)
      if (documentLinks && documentLinks.length > 0) {
        for (const dl of documentLinks) {
          const linkId = await linkDocuments(client, dl.sourceType, dl.sourceId, dl.sourceNumber, dl.targetType, dl.targetId, dl.targetNumber);
          result.documentLinkIds.push(linkId);
        }
      }

      // Phase 6: Entity balance — suppliers: sync from open_items (source of truth)
      if (entityBalanceUpdate) {
        const ebu = entityBalanceUpdate;
        if (ebu.entityType === 'supplier' && ebu.entityId) {
          await syncSupplierBalanceFromOpenItems(client, ebu.entityId);
        } else if (ebu.entityType === 'customer') {
          await client.query('UPDATE clients SET current_balance = COALESCE(current_balance, 0) + $1 WHERE id = $2', [ebu.amount, ebu.entityId]);
        }
      }

      // Phase 7: Audit log (ERP traceability)
      await auditLog(client, {
        tableName: 'transactions',
        recordId: documentId,
        action: 'process',
        userId,
        userName: body.userName,
        branchId,
        oldValues: null,
        newValues: {
          transactionType,
          documentNumber,
          date,
          amount,
          currency,
          stockEntriesCount: stockEntries?.length || 0,
          journalLinesCount: journalLines?.length || 0,
          taxLinesCount: Array.isArray(taxLines) ? taxLines.length : 0,
        },
        description: `${transactionType} ${documentNumber} processed`,
      });

      result.success = true;
      console.log(
        `[TX] ${transactionType} ${documentNumber}: stock=${result.stockMovementIds.length}, ` +
        `journal=${!!result.journalEntryId}, openItem=${!!result.openItemId} ✓`
      );
      return result;
}

module.exports = { processTransactionBody, isUniqueSkuBranchError };
