/**
 * Real-time AGT Validation Hook
 * Handles invoice transmission and validation with AGT (Administração Geral Tributária)
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Sale } from '@/types/erp';
import { AGTTransmissionResult, AGTStatusResult, AGTConfig } from '@/types/electron';
import { getInvoiceHash } from '@/lib/agtQRCode';
import { useTranslation } from '@/i18n';

interface AGTValidationState {
  isTransmitting: boolean;
  isConfigured: boolean;
  environment: 'production' | 'sandbox';
  lastError: string | null;
}

interface TransmitOptions {
  withRetry?: boolean;
  keyAlias?: string;
  passphrase?: string;
}

export function useAGTValidation() {
  const { t } = useTranslation();
  const [state, setState] = useState<AGTValidationState>({
    isTransmitting: false,
    isConfigured: false,
    environment: 'sandbox',
    lastError: null
  });

  const isElectron = !!window.electronAPI?.agt;

  // Check if AGT is configured on mount
  useEffect(() => {
    async function checkConfig() {
      if (!isElectron) return;
      
      try {
        const result = await window.electronAPI!.agt.getConfig();
        if (result.success && result.config) {
          setState(prev => ({
            ...prev,
            isConfigured: !!result.config!.companyNIF,
            environment: result.config!.environment || 'sandbox'
          }));
        }
      } catch (error) {
        console.error('[AGT] Config check failed:', error);
      }
    }
    
    checkConfig();
  }, [isElectron]);

  /**
   * Configure AGT client
   */
  const configure = useCallback(async (config: AGTConfig): Promise<boolean> => {
    if (!isElectron) {
      toast.error(t.agtUi.desktopOnly);
      return false;
    }

    try {
      const result = await window.electronAPI!.agt.configure(config);
      
      if (result.success) {
        setState(prev => ({
          ...prev,
          isConfigured: true,
          environment: config.environment,
          lastError: null
        }));
        toast.success(t.agtUi.configuredSuccess);
        return true;
      } else {
        setState(prev => ({ ...prev, lastError: result.error || t.agtUi.configError }));
        toast.error(result.error || t.agtUi.configureFailed);
        return false;
      }
    } catch (error: any) {
      setState(prev => ({ ...prev, lastError: error.message }));
      toast.error(t.agtUi.configureFailed);
      return false;
    }
  }, [isElectron]);

  /**
   * Sign and transmit invoice to AGT
   */
  const transmitInvoice = useCallback(async (
    sale: Sale,
    options: TransmitOptions = {}
  ): Promise<AGTTransmissionResult> => {
    const { withRetry = true, keyAlias = 'default', passphrase = '' } = options;

    // Check if running in Electron
    if (!isElectron) {
      // Fall back to simulated mode in browser
      console.log('[AGT] Browser mode - using simulated transmission');
      return simulatedTransmit(sale);
    }

    setState(prev => ({ ...prev, isTransmitting: true, lastError: null }));
    toast.info(t.agtUi.signingAndTransmitting, { id: 'agt-transmit' });

    try {
      // Step 1: Sign the invoice
      const signResult = await window.electronAPI!.agt.signInvoice(
        {
          invoiceNumber: sale.invoiceNumber,
          date: sale.createdAt,
          total: sale.total,
          customerNif: sale.customerNif,
          items: sale.items
        },
        keyAlias,
        passphrase
      );

      if (!signResult.success) {
        throw new Error(signResult.error || t.agtUi.signInvoiceFailed);
      }

      // Step 2: Build invoice payload
      const invoicePayload = {
        invoiceNumber: sale.invoiceNumber,
        documentType: 'FT',
        date: sale.createdAt,
        customerNif: sale.customerNif || '999999990',
        customerName: sale.customerName || 'Consumidor Final',
        subtotal: sale.subtotal,
        taxAmount: sale.taxAmount,
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        items: sale.items,
        atcud: `${sale.invoiceNumber.replace(/[^0-9]/g, '')}-${getInvoiceHash(sale)}`
      };

      // Step 3: Transmit to AGT
      const transmitFn = withRetry 
        ? window.electronAPI!.agt.transmitWithRetry 
        : window.electronAPI!.agt.transmitInvoice;

      const result = await transmitFn(invoicePayload, {
        hash: signResult.hash,
        shortHash: signResult.shortHash,
        signature: signResult.signature,
        algorithm: signResult.algorithm
      });

      if (result.success && result.agtStatus === 'validated') {
        toast.success(
          t.agtUi.invoiceValidated.replace('{code}', String(result.agtCode || '')),
          { id: 'agt-transmit' }
        );
        
        // Update local sale with AGT info
        updateLocalSale(sale.id, {
          agtStatus: 'validated',
          agtCode: result.agtCode,
          agtValidatedAt: result.validatedAt
        });
      } else if (result.agtStatus === 'pending') {
        toast.info(t.agtUi.invoicePending, { id: 'agt-transmit' });
      } else {
        toast.error(result.errorMessage || t.agtUi.validationError, { id: 'agt-transmit' });
        setState(prev => ({ ...prev, lastError: result.errorMessage || null }));
      }

      return result;
    } catch (error: any) {
      console.error('[AGT] Transmission error:', error);
      toast.error(error.message || t.agtUi.transmitFailed, { id: 'agt-transmit' });
      setState(prev => ({ ...prev, lastError: error.message }));
      
      return {
        success: false,
        agtStatus: 'error',
        errorMessage: error.message,
        retryable: true
      };
    } finally {
      setState(prev => ({ ...prev, isTransmitting: false }));
    }
  }, [isElectron]);

  /**
   * Check invoice status at AGT
   */
  const checkStatus = useCallback(async (invoiceNumber: string): Promise<AGTStatusResult> => {
    if (!isElectron) {
      // Simulated status check
      const sales = JSON.parse(localStorage.getItem('kwanza_sales') || '[]') as Sale[];
      const sale = sales.find(s => s.invoiceNumber === invoiceNumber);
      
      return {
        success: true,
        invoiceNumber,
        agtStatus: sale?.agtStatus as any || 'pending',
        agtCode: sale?.agtCode,
        validatedAt: sale?.agtValidatedAt
      };
    }

    try {
      return await window.electronAPI!.agt.checkStatus(invoiceNumber);
    } catch (error: any) {
      return {
        success: false,
        invoiceNumber,
        agtStatus: 'error',
        errorMessage: error.message
      };
    }
  }, [isElectron]);

  /**
   * Void an invoice at AGT
   */
  const voidInvoice = useCallback(async (
    invoiceNumber: string,
    reason: string
  ): Promise<{ success: boolean; errorMessage?: string }> => {
    if (!isElectron) {
      toast.error(t.agtUi.voidDesktopOnly);
      return { success: false, errorMessage: t.agtUi.desktopRequired };
    }

    toast.info(t.agtUi.voidingInvoice, { id: 'agt-void' });

    try {
      const result = await window.electronAPI!.agt.voidInvoice(invoiceNumber, reason);
      
      if (result.success) {
        toast.success(t.agtUi.invoiceVoided, { id: 'agt-void' });
      } else {
        toast.error(result.errorMessage || t.agtUi.voidFailed, { id: 'agt-void' });
      }
      
      return result;
    } catch (error: any) {
      toast.error(error.message || t.agtUi.voidFailed, { id: 'agt-void' });
      return { success: false, errorMessage: error.message };
    }
  }, [isElectron]);

  /**
   * Batch transmit pending invoices
   */
  const transmitPending = useCallback(async (
    options: TransmitOptions = {}
  ): Promise<{ transmitted: number; failed: number }> => {
    const sales = JSON.parse(localStorage.getItem('kwanza_sales') || '[]') as Sale[];
    const pending = sales.filter(s => s.agtStatus === 'pending' || !s.agtStatus);
    
    let transmitted = 0;
    let failed = 0;

    toast.info(t.agtUi.transmittingPending.replace('{count}', String(pending.length)));

    for (const sale of pending) {
      const result = await transmitInvoice(sale, options);
      if (result.success) {
        transmitted++;
      } else {
        failed++;
      }
      // Small delay between transmissions
      await new Promise(r => setTimeout(r, 500));
    }

    toast.success(
      t.agtUi.transmitSummary
        .replace('{transmitted}', String(transmitted))
        .replace('{failed}', String(failed))
    );
    return { transmitted, failed };
  }, [transmitInvoice]);

  return {
    ...state,
    isElectron,
    configure,
    transmitInvoice,
    checkStatus,
    voidInvoice,
    transmitPending
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Simulated AGT transmission for browser mode
 */
async function simulatedTransmit(sale: Sale): Promise<AGTTransmissionResult> {
  // Simulate network delay
  await new Promise(r => setTimeout(r, 1500));

  // Generate simulated AGT code
  const agtCode = `AGT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const validatedAt = new Date().toISOString();

  // Update local storage
  updateLocalSale(sale.id, {
    agtStatus: 'validated',
    agtCode,
    agtValidatedAt: validatedAt
  });

  return {
    success: true,
    agtCode,
    agtStatus: 'validated',
    validatedAt
  };
}

/**
 * Update sale in local storage
 */
function updateLocalSale(saleId: string, updates: Partial<Sale>) {
  const sales = JSON.parse(localStorage.getItem('kwanza_sales') || '[]') as Sale[];
  const index = sales.findIndex(s => s.id === saleId);
  
  if (index !== -1) {
    sales[index] = { ...sales[index], ...updates };
    localStorage.setItem('kwanza_sales', JSON.stringify(sales));
  }
}
