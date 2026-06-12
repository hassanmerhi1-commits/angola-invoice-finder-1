import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';

export function useVoidInvoice() {
  const { t } = useTranslation();
  const [voiding, setVoiding] = useState(false);

  const voidInvoice = useCallback(async (
    invoiceId: string,
    reason: string,
    options?: { onSuccess?: () => void; documentNumber?: string },
  ) => {
    setVoiding(true);
    const toastId = `void-invoice-${invoiceId}`;
    toast.info(t.voidInvoiceUi.voiding, { id: toastId });
    try {
      const res = await api.agt.voidInvoice({ invoiceId, reason });
      if (res.error) throw new Error(res.error);
      const label = options?.documentNumber || res.data?.invoiceNumber || '';
      toast.success(
        t.voidInvoiceUi.success.replace('{number}', label),
        { id: toastId },
      );
      options?.onSuccess?.();
      return res.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : t.voidInvoiceUi.failed;
      toast.error(message, { id: toastId });
      throw err;
    } finally {
      setVoiding(false);
    }
  }, [t]);

  return { voidInvoice, voiding };
}
