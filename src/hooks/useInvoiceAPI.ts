import { useState, useCallback } from 'react';
import { 
  createInvoice, 
  sendToAGT, 
  getAGTStatus,
  validateNIF,
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  AGTValidationResponse
} from '@/lib/api/invoices';
import { 
  generateSAFT, 
  getMonthlyVATReport, 
  downloadSAFT,
  SAFTExportResponse,
  MonthlyVATReport
} from '@/lib/api/saft';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

export function useInvoiceAPI() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<CreateInvoiceResponse | null>(null);

  const createNewInvoice = useCallback(async (
    request: CreateInvoiceRequest,
    branchId: string,
    branchCode: string,
    userId: string
  ): Promise<CreateInvoiceResponse> => {
    setIsLoading(true);
    try {
      const response = await createInvoice(request, branchId, branchCode, userId);
      setLastResponse(response);
      
      if (response.status === 'error') {
        toast.error(response.error || t.invoiceApiUi.createInvoiceFailed);
      } else {
        toast.success(
          t.invoiceApiUi.invoiceCreated
            .replace('{number}', String(response.invoice_number || ''))
        );
      }
      
      return response;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const validateAndSendToAGT = useCallback(async (
    invoiceId: string
  ): Promise<AGTValidationResponse> => {
    setIsLoading(true);
    try {
      toast.info(t.invoiceApiUi.sendingToAgt);
      const response = await sendToAGT(invoiceId);
      
      if (response.status === 'validated') {
        toast.success(t.invoiceApiUi.agtValidated.replace('{code}', String(response.agt_code || '')));
      } else if (response.status === 'error') {
        toast.error(response.error || t.invoiceApiUi.agtValidationError);
      }
      
      return response;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkAGTStatus = useCallback(async (invoiceId: string) => {
    return getAGTStatus(invoiceId);
  }, []);

  const validateNIFNumber = useCallback((nif: string) => {
    return validateNIF(nif);
  }, []);

  return {
    isLoading,
    lastResponse,
    createNewInvoice,
    validateAndSendToAGT,
    checkAGTStatus,
    validateNIFNumber
  };
}

export function useSAFTAPI() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [lastExport, setLastExport] = useState<SAFTExportResponse | null>(null);

  const exportSAFT = useCallback((month: number, year: number, branchId?: string): SAFTExportResponse => {
    setIsLoading(true);
    try {
      const response = generateSAFT({ month, year, branchId });
      setLastExport(response);
      toast.success(
        t.invoiceApiUi.saftGenerated
          .replace('{count}', String(response.total_invoices))
      );
      return response;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const downloadSAFTFile = useCallback((response: SAFTExportResponse) => {
    downloadSAFT(response.xml, response.file);
    toast.success(t.invoiceApiUi.fileDownloaded.replace('{file}', response.file));
  }, []);

  const getVATReport = useCallback((month: number, year: number, branchId?: string): MonthlyVATReport => {
    return getMonthlyVATReport(month, year, branchId);
  }, []);

  return {
    isLoading,
    lastExport,
    exportSAFT,
    downloadSAFTFile,
    getVATReport
  };
}
