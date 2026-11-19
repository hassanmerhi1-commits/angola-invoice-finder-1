import { useState, useEffect } from 'react';
import { getCompanySettings } from '@/lib/companySettings';

export function useCompanyLogo() {
  const cached = getCompanySettings();
  const [logo, setLogo] = useState<string | null>(cached.logo || null);
  const [companyName, setCompanyName] = useState(cached.tradeName || cached.name || 'NEXOR ERP');

  useEffect(() => {
    const loadSettings = () => {
      const settings = getCompanySettings();
      setLogo(settings.logo || null);
      setCompanyName(settings.tradeName || settings.name || 'NEXOR ERP');
    };
    loadSettings();
    // Listen for storage changes (when settings are saved)
    const handler = () => loadSettings();
    window.addEventListener('storage', handler);
    window.addEventListener('company-settings-updated', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('company-settings-updated', handler);
    };
  }, []);

  return { logo, companyName };
}
