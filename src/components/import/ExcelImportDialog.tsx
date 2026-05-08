import { useState, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download, X, AlertTriangle, RefreshCw, Settings2 } from 'lucide-react';
import { ColumnMappingDialog, ColumnMapping } from './ColumnMappingDialog';
import { getExcelHeaders } from '@/lib/excel';
import { useTranslation } from '@/i18n';

interface ImportError {
  row: number;
  errors: string[];
}

interface DuplicateInfo<T> {
  item: T;
  existingKey: string;
  rowIndex: number;
}

interface ExcelImportDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  parseFile: (file: File, mappings?: ColumnMapping[]) => Promise<T[]>;
  validateData: (data: T[]) => { valid: T[]; errors: ImportError[] };
  onImport: (data: T[], options?: { skipDuplicates?: boolean; updateDuplicates?: boolean }) => void;
  downloadTemplate: () => void;
  columns: { key: keyof T; label: string }[];
  // Duplicate detection
  duplicateKey?: keyof T; // The key to check for duplicates (e.g., 'codigo', 'nif')
  existingKeys?: string[]; // Array of existing keys to check against
  duplicateLabel?: string; // Label for the duplicate key (e.g., 'SKU', 'NIF')
  // Column mapping
  mappingType?: 'products' | 'clients' | 'suppliers';
}

export function ExcelImportDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  parseFile,
  validateData,
  onImport,
  downloadTemplate,
  columns,
  duplicateKey,
  existingKeys = [],
  duplicateLabel,
  mappingType,
}: ExcelImportDialogProps<T>) {
  const { t } = useTranslation();
  const resolvedDuplicateLabel = duplicateLabel || t.importUi.duplicateLabelDefault;
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [parsedData, setParsedData] = useState<T[]>([]);
  const [validData, setValidData] = useState<T[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update' | 'include'>('skip');
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect duplicates
  const { duplicates, newItems } = useMemo(() => {
    if (!duplicateKey || existingKeys.length === 0) {
      return { duplicates: [], newItems: validData };
    }

    const dupes: DuplicateInfo<T>[] = [];
    const newOnes: T[] = [];
    const existingSet = new Set(existingKeys.map(k => k.toLowerCase().trim()));

    validData.forEach((item, idx) => {
      const keyValue = String(item[duplicateKey] || '').toLowerCase().trim();
      if (keyValue && existingSet.has(keyValue)) {
        dupes.push({ item, existingKey: keyValue, rowIndex: idx });
      } else {
        newOnes.push(item);
      }
    });

    return { duplicates: dupes, newItems: newOnes };
  }, [validData, duplicateKey, existingKeys]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setCurrentFile(file);
    
    try {
      // Detect headers for column mapping
      const headers = await getExcelHeaders(file);
      setDetectedHeaders(headers);
      
      // Parse with current mappings (if any)
      const data = await parseFile(file, columnMappings.length > 0 ? columnMappings : undefined);
      setParsedData(data);
      
      const { valid, errors } = validateData(data);
      setValidData(valid);
      setErrors(errors);
      setStep('preview');
    } catch (error) {
      console.error('Error parsing file:', error);
      setErrors([{ row: 0, errors: [t.importUi.fileProcessError] }]);
    }
  };

  const handleApplyMapping = async (mappings: ColumnMapping[]) => {
    setColumnMappings(mappings);
    
    if (currentFile) {
      try {
        const data = await parseFile(currentFile, mappings);
        setParsedData(data);
        
        const { valid, errors } = validateData(data);
        setValidData(valid);
        setErrors(errors);
      } catch (error) {
        console.error('Error re-parsing with mappings:', error);
      }
    }
  };

  const handleImport = () => {
    setStep('importing');
    
    // Determine what to import based on duplicate action
    let dataToImport: T[] = [];
    
    if (duplicateAction === 'skip') {
      dataToImport = newItems;
    } else if (duplicateAction === 'update') {
      // Import all, let the handler know to update existing
      dataToImport = validData;
      onImport(dataToImport, { updateDuplicates: true });
      handleClose();
      return;
    } else {
      // Include all (may create duplicates)
      dataToImport = validData;
    }
    
    onImport(dataToImport, { skipDuplicates: duplicateAction === 'skip' });
    handleClose();
  };

  const handleClose = () => {
    setStep('upload');
    setParsedData([]);
    setValidData([]);
    setErrors([]);
    setFileName('');
    setDuplicateAction('skip');
    setColumnMappings([]);
    setDetectedHeaders([]);
    setCurrentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onOpenChange(false);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const importCount = duplicateAction === 'skip' ? newItems.length : validData.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {step === 'upload' && (
            <div className="space-y-4">
              <div 
                onClick={triggerFileInput}
                className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium mb-2">Clique para selecionar ficheiro</p>
                <p className="text-sm text-muted-foreground">
                  Suporta ficheiros Excel (.xlsx, .xls) e CSV
                </p>
              </div>

              <div className="flex justify-center">
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="w-4 h-4 mr-2" />
                  Baixar Template de Exemplo
                </Button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />
                  <span className="font-medium">{fileName}</span>
                  {columnMappings.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      <Settings2 className="w-3 h-3 mr-1" />
                      Mapeamento personalizado
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {mappingType && (
                    <Button variant="outline" size="sm" onClick={() => setShowMappingDialog(true)}>
                      <Settings2 className="w-4 h-4 mr-1" />
                      Mapear Colunas
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setStep('upload')}>
                    <X className="w-4 h-4 mr-1" />
                    Escolher outro ficheiro
                  </Button>
                </div>
              </div>

              <div className="flex gap-4 flex-wrap">
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {validData.length} válidos
                </Badge>
                {errors.length > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.length} com erros
                  </Badge>
                )}
                {duplicates.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600">
                    <AlertTriangle className="w-3 h-3" />
                    {duplicates.length} duplicados
                  </Badge>
                )}
                {newItems.length > 0 && duplicates.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                    <CheckCircle2 className="w-3 h-3" />
                    {newItems.length} novos
                  </Badge>
                )}
              </div>

              {/* Duplicate Warning */}
              {duplicates.length > 0 && (
                <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription>
                    <div className="font-medium mb-2 text-amber-800 dark:text-amber-200">
                      {duplicates.length} {resolvedDuplicateLabel}(s) já existem no sistema
                    </div>
                    <div className="space-y-2 text-sm">
                      <p className="text-amber-700 dark:text-amber-300">
                        Os seguintes registos têm {resolvedDuplicateLabel} duplicados:
                      </p>
                      <div className="max-h-20 overflow-auto bg-amber-100 dark:bg-amber-900/30 p-2 rounded text-xs font-mono">
                        {duplicates.slice(0, 10).map((d, i) => (
                          <div key={i}>{d.existingKey.toUpperCase()}</div>
                        ))}
                        {duplicates.length > 10 && (
                          <div className="text-amber-600">... e mais {duplicates.length - 10}</div>
                        )}
                      </div>
                      
                      <div className="pt-2 space-y-2">
                        <p className="font-medium text-amber-800 dark:text-amber-200">O que deseja fazer?</p>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox 
                              checked={duplicateAction === 'skip'} 
                              onCheckedChange={() => setDuplicateAction('skip')}
                            />
                            <span>Ignorar duplicados (importar apenas {newItems.length} novos)</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox 
                              checked={duplicateAction === 'update'} 
                              onCheckedChange={() => setDuplicateAction('update')}
                            />
                            <span className="flex items-center gap-1">
                              <RefreshCw className="w-3 h-3" />
                              Actualizar existentes com dados do ficheiro
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-medium mb-1">Erros encontrados:</div>
                    <ul className="list-disc list-inside text-sm max-h-24 overflow-auto">
                      {errors.slice(0, 5).map((error, idx) => (
                        <li key={idx}>
                          Linha {error.row}: {error.errors.join(', ')}
                        </li>
                      ))}
                      {errors.length > 5 && (
                        <li>... e mais {errors.length - 5} erros</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {validData.length > 0 && (
                <ScrollArea className="h-[250px] border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead className="w-20">Estado</TableHead>
                        {columns.map((col) => (
                          <TableHead key={String(col.key)}>{col.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {validData.slice(0, 100).map((row, idx) => {
                        const isDupe = duplicates.some(d => d.rowIndex === idx);
                        return (
                          <TableRow key={idx} className={isDupe ? 'bg-amber-50 dark:bg-amber-950/20' : ''}>
                            <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell>
                              {isDupe ? (
                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-600">
                                  Duplicado
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                  Novo
                                </Badge>
                              )}
                            </TableCell>
                            {columns.map((col) => (
                              <TableCell key={String(col.key)}>
                                {String(row[col.key] || '-')}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {validData.length > 100 && (
                    <div className="p-2 text-center text-sm text-muted-foreground border-t">
                      Mostrando 100 de {validData.length} registos
                    </div>
                  )}
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          {step === 'preview' && importCount > 0 && (
            <Button onClick={handleImport}>
              <Upload className="w-4 h-4 mr-2" />
              {duplicateAction === 'update' 
                ? `Importar e Actualizar ${validData.length} registos`
                : `Importar ${importCount} registos`
              }
            </Button>
          )}
          {step === 'preview' && importCount === 0 && validData.length > 0 && (
            <Button disabled>
              Todos são duplicados
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Column Mapping Dialog */}
      {mappingType && (
        <ColumnMappingDialog
          open={showMappingDialog}
          onOpenChange={setShowMappingDialog}
          type={mappingType}
          onApplyMapping={handleApplyMapping}
          excelColumns={detectedHeaders}
        />
      )}
    </Dialog>
  );
}
