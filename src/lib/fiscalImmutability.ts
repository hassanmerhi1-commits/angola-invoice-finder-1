import type { ERPDocument, DocumentType } from '@/types/documents';

const IMMUTABLE_ISSUED_TYPES: DocumentType[] = [
  'fatura_venda',
  'nota_credito',
  'nota_debito',
  'guia_remessa',
];

export function isFiscallyImmutable(doc: ERPDocument): boolean {
  if (doc.fiscalLocked) return true;
  if (!IMMUTABLE_ISSUED_TYPES.includes(doc.documentType)) return false;
  if (doc.documentType === 'fatura_venda') {
    return doc.status !== 'draft';
  }
  return doc.status === 'confirmed' || doc.status === 'paid' || doc.status === 'partial';
}

export function allowsDueDateOnlyEdit(doc: ERPDocument): boolean {
  return doc.documentType === 'fatura_venda' && isFiscallyImmutable(doc);
}
