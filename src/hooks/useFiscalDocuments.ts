// Fiscal Documents Hooks — API-backed (Phase 1 AGT)
import { useState, useEffect, useCallback } from 'react';
import {
  CreditNote,
  CreditNoteItem,
  DebitNote,
  DebitNoteItem,
  TransportDocument,
  TransportDocumentItem,
  CompanyInfo,
  SAFTExport,
  Sale,
} from '@/types/erp';
import * as fiscalStorage from '@/lib/fiscalDocuments';
import { processSaleRefund } from '@/lib/accountingStorage';
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList } from '@/lib/listCache';
import { CREDIT_NOTES_CHANGED_EVENT } from '@/lib/storage';
import { getCompanySettings } from '@/lib/companySettings';
import { exportSAFTToXML } from '@/lib/saftAO';

async function resolveBranchName(branchId: string, cachedName?: string) {
  if (cachedName) return cachedName;
  try {
    const response = await api.branches.list();
    const branches = response.data || [];
    return branches.find((b: { id: string }) => b.id === branchId)?.name || '';
  } catch {
    return '';
  }
}

// ==================== CREDIT NOTES ====================

export function useCreditNotes(branchId?: string, deferInitialLoad = false) {
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>(
    () => getCachedList<CreditNote[]>(`creditNotes:${branchId ?? 'all'}`) ?? [],
  );
  const [loading, setLoading] = useState(false);

  const refreshCreditNotes = useCallback(async (listBranchId?: string) => {
    setLoading(true);
    const filterBranch = listBranchId !== undefined ? listBranchId : branchId;
    const cacheKey = `creditNotes:${filterBranch || branchId || 'all'}`;
    try {
      let result = await api.fiscalDocuments.listCreditNotes(filterBranch || undefined);
      if (result.error) throw new Error(result.error);
      if (result.data) {
        let notes = result.data as CreditNote[];
        if (notes.length === 0 && filterBranch) {
          const allRes = await api.fiscalDocuments.listCreditNotes();
          if (allRes.data?.length) notes = allRes.data as CreditNote[];
        }
        setCreditNotes(notes);
        setCachedList(cacheKey, notes);
        setLoading(false);
        return;
      }
    } catch {
      /* fallback below */
    }
    const local = fiscalStorage.getCreditNotes(filterBranch || branchId);
    setCreditNotes(local);
    setCachedList(cacheKey, local);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    if (deferInitialLoad) return;
    void refreshCreditNotes();
  }, [refreshCreditNotes, deferInitialLoad]);

  useEffect(() => {
    const onChanged = () => { void refreshCreditNotes(); };
    window.addEventListener(CREDIT_NOTES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CREDIT_NOTES_CHANGED_EVENT, onChanged);
  }, [refreshCreditNotes]);

  const createCreditNote = useCallback(async (
    branchIdParam: string,
    branchCode: string,
    originalSale: Sale,
    reason: CreditNote['reason'],
    reasonDescription: string,
    items: CreditNoteItem[],
    issuedBy: string,
    restoreStock: boolean = true,
    branchNameHint?: string,
  ): Promise<CreditNote> => {
    const branchName = await resolveBranchName(branchIdParam, branchNameHint);
    const payload = {
      branchId: branchIdParam,
      branchCode,
      branchName,
      originalInvoiceId: originalSale.id,
      reason,
      reasonDescription,
      items,
      issuedBy,
      issuedByName: issuedBy,
      restoreStock,
    };

    const result = await api.fiscalDocuments.createCreditNote(payload);
    if (result.error || !result.data) {
      throw new Error(result.error || 'Failed to create credit note');
    }

    const note = result.data as CreditNote;
    // Annotate the original sale's payment method so shift/drawer filtering works even
    // when the original invoice isn't in the terminal's loaded sales list.
    if (!note.originalPaymentMethod && originalSale.paymentMethod) {
      note.originalPaymentMethod = originalSale.paymentMethod;
    }
    setCreditNotes((prev) => {
      const rest = prev.filter((n) => n.id !== note.id);
      return [note, ...rest];
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CREDIT_NOTES_CHANGED_EVENT, {
        detail: { branchId: note.branchId },
      }));
    }

    const paymentMethod = String(
      originalSale.paymentMethod
      || (note as CreditNote & { originalPaymentMethod?: string }).originalPaymentMethod
      || '',
    ).toLowerCase();
    if (paymentMethod === 'cash') {
      void processSaleRefund(
        branchIdParam,
        note.id,
        note.documentNumber,
        originalSale.invoiceNumber,
        note.total,
        issuedBy,
        originalSale.customerName,
      )
        .then(() => {
          window.dispatchEvent(
            new CustomEvent('nexor:pos-caixa-refund', {
              detail: { branchId: branchIdParam, amount: note.total },
            }),
          );
        })
        .catch((err) => console.warn('[CAIXA] Local refund sync failed:', err));
    }

    return note;
  }, []);

  const cancelCreditNote = useCallback(async (noteId: string) => {
    const notes = creditNotes.length ? creditNotes : fiscalStorage.getCreditNotes();
    const note = notes.find((n) => n.id === noteId);
    if (note && note.status === 'draft') {
      note.status = 'cancelled';
      fiscalStorage.saveCreditNote(note);
      await refreshCreditNotes();
    }
  }, [creditNotes, refreshCreditNotes]);

  return { creditNotes, createCreditNote, cancelCreditNote, refreshCreditNotes, loading };
}

// ==================== DEBIT NOTES ====================

export function useDebitNotes(branchId?: string) {
  const [debitNotes, setDebitNotes] = useState<DebitNote[]>(
    () => getCachedList<DebitNote[]>(`debitNotes:${branchId ?? 'all'}`) ?? [],
  );
  const [loading, setLoading] = useState(false);

  const refreshDebitNotes = useCallback(async () => {
    setLoading(true);
    const cacheKey = `debitNotes:${branchId ?? 'all'}`;
    try {
      const result = await api.fiscalDocuments.listDebitNotes(branchId);
      if (result.data) {
        const notes = result.data as DebitNote[];
        setDebitNotes(notes);
        setCachedList(cacheKey, notes);
        setLoading(false);
        return;
      }
    } catch {
      /* fallback */
    }
    const local = fiscalStorage.getDebitNotes(branchId);
    setDebitNotes(local);
    setCachedList(cacheKey, local);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    void refreshDebitNotes();
  }, [refreshDebitNotes]);

  const createDebitNote = useCallback(async (
    branchIdParam: string,
    branchCode: string,
    originalSale: Sale | null,
    reason: DebitNote['reason'],
    reasonDescription: string,
    items: DebitNoteItem[],
    issuedBy: string,
    customerNif?: string,
    customerName?: string,
  ): Promise<DebitNote> => {
    const branchName = await resolveBranchName(branchIdParam);
    const payload = {
      branchId: branchIdParam,
      branchCode,
      branchName,
      originalInvoiceId: originalSale?.id,
      reason,
      reasonDescription,
      items,
      issuedBy,
      issuedByName: issuedBy,
      customerNif: customerNif || originalSale?.customerNif,
      customerName: customerName || originalSale?.customerName,
    };

    const result = await api.fiscalDocuments.createDebitNote(payload);
    if (result.error || !result.data) {
      throw new Error(result.error || 'Failed to create debit note');
    }

    const note = result.data as DebitNote;
    setDebitNotes((prev) => [note, ...prev]);
    return note;
  }, []);

  const cancelDebitNote = useCallback(async (noteId: string) => {
    const notes = debitNotes.length ? debitNotes : fiscalStorage.getDebitNotes();
    const note = notes.find((n) => n.id === noteId);
    if (note && note.status === 'draft') {
      note.status = 'cancelled';
      fiscalStorage.saveDebitNote(note);
      await refreshDebitNotes();
    }
  }, [debitNotes, refreshDebitNotes]);

  return { debitNotes, createDebitNote, cancelDebitNote, refreshDebitNotes, loading };
}

// ==================== TRANSPORT DOCUMENTS ====================

export function useTransportDocuments(branchId?: string) {
  const [transportDocs, setTransportDocs] = useState<TransportDocument[]>(
    () => getCachedList<TransportDocument[]>(`transportDocs:${branchId ?? 'all'}`) ?? [],
  );
  const [loading, setLoading] = useState(false);

  const refreshTransportDocs = useCallback(async () => {
    setLoading(true);
    const cacheKey = `transportDocs:${branchId ?? 'all'}`;
    try {
      const result = await api.fiscalDocuments.listTransportDocuments(branchId);
      if (result.data) {
        const docs = result.data as TransportDocument[];
        setTransportDocs(docs);
        setCachedList(cacheKey, docs);
        setLoading(false);
        return;
      }
    } catch {
      /* fallback */
    }
    const local = fiscalStorage.getTransportDocuments(branchId);
    setTransportDocs(local);
    setCachedList(cacheKey, local);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    void refreshTransportDocs();
  }, [refreshTransportDocs]);

  const createTransportDocument = useCallback(async (
    branchIdParam: string,
    branchCode: string,
    type: TransportDocument['type'],
    originAddress: string,
    originCity: string,
    destinationAddress: string,
    destinationCity: string,
    loadingDate: string,
    loadingTime: string,
    items: TransportDocumentItem[],
    issuedBy: string,
    options?: {
      destinationNif?: string;
      destinationName?: string;
      transporterName?: string;
      transporterNif?: string;
      vehiclePlate?: string;
      relatedInvoiceId?: string;
      relatedInvoiceNumber?: string;
      notes?: string;
      totalWeight?: number;
      totalVolume?: number;
    },
  ): Promise<TransportDocument> => {
    const branchName = await resolveBranchName(branchIdParam);
    const payload = {
      branchId: branchIdParam,
      branchCode,
      branchName,
      type,
      originAddress,
      originCity,
      destinationAddress,
      destinationCity,
      loadingDate,
      loadingTime,
      items,
      issuedBy,
      issuedByName: issuedBy,
      ...options,
    };

    const result = await api.fiscalDocuments.createTransportDocument(payload);
    if (result.error || !result.data) {
      throw new Error(result.error || 'Failed to create transport document');
    }

    const doc = result.data as TransportDocument;
    setTransportDocs((prev) => [doc, ...prev]);
    return doc;
  }, []);

  const updateTransportStatus = useCallback(async (
    docId: string,
    status: TransportDocument['status'],
  ) => {
    const result = await api.fiscalDocuments.updateTransportStatus(docId, status);
    if (result.data) {
      setTransportDocs((prev) => prev.map((d) => (d.id === docId ? (result.data as TransportDocument) : d)));
      return;
    }
    fiscalStorage.getTransportDocuments();
    const docs = fiscalStorage.getTransportDocuments();
    const doc = docs.find((d) => d.id === docId);
    if (doc) {
      doc.status = status;
      if (status === 'delivered') {
        doc.deliveredAt = new Date().toISOString();
      }
      fiscalStorage.saveTransportDocument(doc);
      await refreshTransportDocs();
    }
  }, [refreshTransportDocs]);

  return { transportDocs, createTransportDocument, updateTransportStatus, refreshTransportDocs, loading };
}

// ==================== COMPANY INFO ====================

export function useCompanyInfo() {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(fiscalStorage.getCompanyInfo());

  const saveCompanyInfo = useCallback((info: CompanyInfo) => {
    fiscalStorage.saveCompanyInfo(info);
    setCompanyInfo(info);
  }, []);

  return { companyInfo, saveCompanyInfo };
}

// ==================== SAF-T EXPORT ====================

export function useSAFTExport() {
  const [exports, setExports] = useState<SAFTExport[]>([]);

  const refreshExports = useCallback(() => {
    setExports(fiscalStorage.getSAFTExports());
  }, []);

  useEffect(() => {
    refreshExports();
  }, [refreshExports]);

  const generateSAFT = useCallback(async (
    periodStart: string,
    periodEnd: string,
    exportedBy: string,
    branchId?: string,
  ): Promise<SAFTExport> => {
    const company = fiscalStorage.getCompanyInfo();
    const fileName = `SAFT_AO_${periodStart.replace(/-/g, '')}_${periodEnd.replace(/-/g, '')}.xml`;

    await api.companySettings.save({ ...getCompanySettings(), ...company }).catch(() => {});

    const response = await api.saft.generate({
      startDate: periodStart,
      endDate: periodEnd,
      branchId,
      company: { ...getCompanySettings(), ...company },
    });

    if (response.error) {
      throw new Error(response.error);
    }

    const saft = response.data as Parameters<typeof exportSAFTToXML>[0] | undefined;
    if (!saft?.AuditFile) {
      throw new Error('Invalid SAF-T response from server');
    }
    const xml = exportSAFTToXML(saft);

    let allSales: Sale[] = [];
    try {
      const salesResponse = await api.sales.list();
      allSales = salesResponse.data || [];
    } catch {
      allSales = [];
    }

    let creditNotesList: CreditNote[] = [];
    let debitNotesList: DebitNote[] = [];
    let transportList: TransportDocument[] = [];
    try {
      creditNotesList = (await api.fiscalDocuments.listCreditNotes(branchId)).data || [];
      debitNotesList = (await api.fiscalDocuments.listDebitNotes(branchId)).data || [];
      transportList = (await api.fiscalDocuments.listTransportDocuments(branchId)).data || [];
    } catch {
      creditNotesList = fiscalStorage.getCreditNotes(branchId);
      debitNotesList = fiscalStorage.getDebitNotes(branchId);
      transportList = fiscalStorage.getTransportDocuments(branchId);
    }

    const saftExport: SAFTExport = {
      id: `saft_${Date.now()}`,
      branchId: branchId || 'all',
      branchName: branchId || 'Todas as Filiais',
      periodStart,
      periodEnd,
      exportType: 'custom',
      company,
      invoices: allSales.filter((s) => {
        const raw = s.createdAt ?? (s as { created_at?: string }).created_at;
        if (!raw) return false;
        const date = String(raw).split('T')[0];
        return date >= periodStart && date <= periodEnd;
      }),
      creditNotes: creditNotesList,
      debitNotes: debitNotesList,
      transportDocs: transportList,
      products: [],
      clients: [],
      exportedBy,
      exportedAt: new Date().toISOString(),
      fileName,
      xmlContent: xml,
    };

    fiscalStorage.saveSAFTExport(saftExport);
    fiscalStorage.downloadSAFTFile(xml, fileName);
    refreshExports();
    return saftExport;
  }, [refreshExports]);

  return { exports, generateSAFT, refreshExports };
}
