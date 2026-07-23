import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Trash2, Upload, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { getApiUrl, getApiUrlAsync, isDemoMode } from '@/lib/api/config';
import { toast } from 'sonner';

export type AttachmentEntityType =
  | 'purchase_invoice'
  | 'expense'
  | 'supplier'
  | 'client'
  | 'sale';

interface AttachmentRow {
  id: string;
  fileName: string;
  contentType?: string;
  byteSize?: number;
  createdAt?: string;
  uploadedByName?: string;
}

function formatBytes(n: number | undefined): string {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function AttachmentPanel({
  entityType,
  entityId,
  title = 'Attachments',
  disabled = false,
}: {
  entityType: AttachmentEntityType;
  entityId: string | null | undefined;
  title?: string;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!entityId || isDemoMode()) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.attachments.list(entityType, entityId);
      if (res.error) throw new Error(res.error);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load attachments');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file || !entityId || disabled) return;
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await api.attachments.upload({
        entityType,
        entityId,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        dataBase64,
      });
      if (res.error) throw new Error(res.error);
      toast.success('Attachment uploaded');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (id: string, fileName: string) => {
    try {
      const token = localStorage.getItem('kwanza_auth_token');
      const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      const base = el?.isElectron ? await getApiUrlAsync() : getApiUrl();
      const url = `${base}/api/attachments/${encodeURIComponent(id)}/download`;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName || 'attachment';
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const onRemove = async (id: string) => {
    if (!window.confirm('Remove this attachment?')) return;
    const res = await api.attachments.remove(id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success('Attachment removed');
    await refresh();
  };

  if (!entityId) return null;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" />
          {title}
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="inline-flex">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            disabled={disabled || uploading || isDemoMode()}
            onChange={(e) => {
              void onUpload(e.target.files);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={disabled || uploading || isDemoMode()}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </Button>
        </div>
      </div>

      {rows.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">No attachments yet.</p>
      )}

      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{row.fileName}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatBytes(row.byteSize)}
                {row.uploadedByName ? ` · ${row.uploadedByName}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => void onDownload(row.id, row.fileName)}
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                disabled={disabled}
                onClick={() => void onRemove(row.id)}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
