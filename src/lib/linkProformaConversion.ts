import type { DocumentType, ERPDocument } from '@/types/documents';
import { saveDocument } from '@/lib/documentStorage';
import { getProFormaById, saveProForma } from '@/lib/proforma';
import { api } from '@/lib/api/client';

/** Mark source proforma as converted after a sales invoice is confirmed. */
export async function linkProformaAfterInvoiceConfirm(
  prefill: ERPDocument,
  invoice: { id: string; documentNumber: string; documentType: DocumentType },
): Promise<void> {
  if (prefill.documentType !== 'proforma') return;

  const fromProformaStore = await getProFormaById(prefill.id);
  if (fromProformaStore) {
    const now = new Date().toISOString();
    await saveProForma({
      ...fromProformaStore,
      status: 'converted',
      convertedToInvoiceId: invoice.id,
      convertedToInvoiceNumber: invoice.documentNumber,
      convertedAt: now,
      updatedAt: now,
    });
    try {
      await api.audit.log({
        tableName: 'proformas',
        recordId: prefill.id,
        action: 'convert',
        description: `Proforma ${prefill.documentNumber} convertida em fatura ${invoice.documentNumber}`,
        metadata: {
          documentKind: 'OR',
          proformaNumber: prefill.documentNumber,
          invoiceId: invoice.id,
          invoiceNumber: invoice.documentNumber,
          invoiceType: invoice.documentType,
        },
      });
    } catch {
      /* backend PUT may already log conversion */
    }
    return;
  }

  await saveDocument({
    ...prefill,
    status: 'converted',
    childDocuments: [
      ...(prefill.childDocuments || []),
      { id: invoice.id, number: invoice.documentNumber, type: invoice.documentType },
    ],
  });
}
