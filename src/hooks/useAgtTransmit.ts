import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { isAgtValidated } from '@/lib/agtStatus';

export type AgtEntityType = 'sale' | 'credit_note' | 'debit_note';

export function useAgtTransmit() {
  const { t } = useTranslation();
  const [transmitting, setTransmitting] = useState(false);

  const transmit = useCallback(async (
    entityType: AgtEntityType,
    entityId: string,
    options?: { force?: boolean; onSuccess?: () => void; documentNumber?: string },
  ) => {
    setTransmitting(true);
    const toastId = `agt-transmit-${entityId}`;
    toast.info(t.agtUi.signingAndTransmitting, { id: toastId });
    try {
      const res = await api.agt.transmit({
        entityType,
        entityId,
        force: options?.force,
        documentNumber: options?.documentNumber,
        invoiceNumber: options?.documentNumber,
      });
      if (res.error) throw new Error(res.error);
      const data = res.data;
      if (data?.skipped) {
        if (isAgtValidated(data?.agtStatus)) {
          toast.success(
            t.agtUi.invoiceValidated.replace('{code}', data.agtCode || '—'),
            { id: toastId },
          );
        } else {
          toast.info(t.agtUi.invoicePending, { id: toastId });
        }
      } else if (isAgtValidated(data?.agtStatus)) {
        toast.success(
          t.agtUi.invoiceValidated.replace('{code}', data.agtCode || '—'),
          { id: toastId },
        );
      } else if (data?.agtStatus === 'pending') {
        toast.info(t.agtUi.invoicePending, { id: toastId });
      } else {
        toast.error(t.agtUi.validationError, { id: toastId });
      }
      options?.onSuccess?.();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : t.agtUi.transmitFailed;
      toast.error(message, { id: toastId });
      throw err;
    } finally {
      setTransmitting(false);
    }
  }, [t]);

  return { transmit, transmitting };
}
