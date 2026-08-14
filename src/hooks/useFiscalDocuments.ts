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
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList } from '@/lib/listCache';
import { CREDIT_NOTES_CHANGED_EVENT } from '@/lib/storage';
import { getCompanySettings, hydrateCompanySettingsFromServer, saveCompanySettingsToServer } from '@/lib/companySettings';
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
      let notes = (result.data || []) as CreditNote[];
      if (notes.length === 0 && filterBranch) {
        const allRes = await api.fiscalDocuments.listCreditNotes();
        if (allRes.data?.length) notes = allRes.data as CreditNote[];
      }
      setCreditNotes(notes);
      setCachedList(cacheKey, notes);
    } catch (err) {
      console.warn('[Fiscal] credit notes list failed — not falling back to localStorage:', err);
      setCreditNotes([]);
    } finally {
      setLoading(false);
    }
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
    // Cash drawer is updated server-side in processCreditNote (recordCashRefundOnOpenSession).
    // Do NOT call processSaleRefund here — that double-counts caixa.
    if (paymentMethod === 'cash' && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('nexor:pos-caixa-refund', {
          detail: { branchId: branchIdParam, amount: note.total },
        }),
      );
    }

    return note;
  }, []);

  const cancelCreditNote = useCallback(async (noteId: string) => {
    const result = await api.fiscalDocuments.cancelCreditNote(noteId);
    if (result.error) {
      throw new Error(result.error || 'Failed to cancel credit note');
    }
    await refreshCreditNotes();
  }, [refreshCreditNotes]);

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
      if (result.error) throw new Error(result.error);
      const notes = (result.data || []) as DebitNote[];
      setDebitNotes(notes);
      setCachedList(cacheKey, notes);
    } catch (err) {
      console.warn('[Fiscal] debit notes list failed — not falling back to localStorage:', err);
      setDebitNotes([]);
    } finally {
      setLoading(false);
    }
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

  const cancelDebitNote = useCallback(async (_noteId: string) => {
    // Debit-note cancel is not exposed by the API yet — refresh only.
    await refreshDebitNotes();
  }, [refreshDebitNotes]);

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
      if (result.error) throw new Error(result.error);
      const docs = (result.data || []) as TransportDocument[];
      setTransportDocs(docs);
      setCachedList(cacheKey, docs);
    } catch (err) {
      console.warn('[Fiscal] transport docs list failed — not falling back to localStorage:', err);
      setTransportDocs([]);
    } finally {
      setLoading(false);
    }
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
    if (result.error || !result.data) {
      throw new Error(result.error || 'Failed to update transport document status');
    }
    setTransportDocs((prev) => prev.map((d) => (d.id === docId ? (result.data as TransportDocument) : d)));
  }, []);

  return { transportDocs, createTransportDocument, updateTransportStatus, refreshTransportDocs, loading };
}

// ==================== COMPANY INFO ====================

export function useCompanyInfo() {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(fiscalStorage.getCompanyInfo());

  useEffect(() => {
    void hydrateCompanySettingsFromServer().then(() => {
      setCompanyInfo(fiscalStorage.getCompanyInfo());
    });
  }, []);

  const saveCompanyInfo = useCallback((info: CompanyInfo) => {
    fiscalStorage.saveCompanyInfo(info);
    setCompanyInfo(info);
    void saveCompanySettingsToServer({
      name: info.name,
      nif: info.nif,
      address: info.address,
      city: info.city,
      province: info.province,
      postalCode: info.postalCode,
      country: info.country,
      phone: info.phone,
      email: info.email,
    }).catch(() => {});
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
    const company = getCompanySettings();
    const fileName = `SAFT_AO_${periodStart.replace(/-/g, '')}_${periodEnd.replace(/-/g, '')}.xml`;

    const response = await api.saft.generate({
      startDate: periodStart,
      endDate: periodEnd,
      branchId,
      company,
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
      throw new Error('Failed to load fiscal documents for SAF-T export');
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
