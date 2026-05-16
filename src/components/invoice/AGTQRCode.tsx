import { useEffect, useState } from 'react';
import { Sale, Branch } from '@/types/erp';
import { 
  generateAGTQRCodeDataURL, 
  formatVerificationText,
  getInvoiceHash 
} from '@/lib/agtQRCode';
import { useTranslation } from '@/i18n';

interface AGTQRCodeProps {
  sale: Sale;
  branch?: Branch | null;
  size?: number;
  showVerificationText?: boolean;
  className?: string;
}

export function AGTQRCode({
  sale,
  branch,
  size = 120,
  showVerificationText = true,
  className = '',
}: AGTQRCodeProps) {
  const { t } = useTranslation();
  const iv = t.invoiceViewUi;
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function generateQR() {
      try {
        const url = await generateAGTQRCodeDataURL(
          sale,
          branch || undefined,
          { size, margin: 1 }
        );
        if (isMounted) {
          setQrCodeUrl(url);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(iv.qrGenerateError);
          console.error('QR Code generation error:', err);
        }
      }
    }

    generateQR();

    return () => {
      isMounted = false;
    };
  }, [sale, branch, size]);

  if (error) {
    return (
      <div className={`text-center text-red-500 text-xs ${className}`}>
        {error}
      </div>
    );
  }

  if (!qrCodeUrl) {
    return (
      <div 
        className={`bg-gray-100 animate-pulse ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const hash = getInvoiceHash(sale);

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <img 
        src={qrCodeUrl} 
        alt="AGT QR Code" 
        width={size} 
        height={size}
        className="border border-gray-200"
      />
      
      {/* Hash Display - Required by AGT */}
      <div className="mt-1 text-center">
        <span className="text-[9px] font-mono text-gray-600">
          Hash: {hash}
        </span>
      </div>
      
      {/* Full Verification Text */}
      {showVerificationText && (
        <div className="mt-1 text-center max-w-full">
          <span className="text-[7px] font-mono text-gray-500 break-all">
            {formatVerificationText(sale, branch || undefined)}
          </span>
        </div>
      )}
      
      {/* AGT Compliance Notice */}
      <div className="mt-1 text-center">
        <span className="text-[7px] text-gray-400">
          {iv.agtCertifiedNotice}
        </span>
      </div>
    </div>
  );
}
