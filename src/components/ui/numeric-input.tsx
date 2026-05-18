import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface NumericInputProps
  extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'onFocus' | 'onBlur'> {
  value: number;
  onValueChange: (value: number) => void;
  /** Whole numbers only (quantity, stock). */
  integer?: boolean;
  min?: number;
  max?: number;
}

/**
 * Text-based numeric field so users can type freely (type="number" + parseInt on
 * every keystroke blocks multi-digit entry in controlled React inputs).
 */
export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ value, onValueChange, integer = false, min, max, className, onFocus, onBlur, ...props }, ref) => {
    const [draft, setDraft] = React.useState<string | null>(null);

    React.useEffect(() => {
      setDraft(null);
    }, [value]);

    const clamp = React.useCallback(
      (n: number) => {
        let v = n;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        return v;
      },
      [min, max],
    );

    const displayValue = draft !== null ? draft : String(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (integer) {
        if (raw !== '' && !/^\d*$/.test(raw)) return;
      } else if (raw !== '' && !/^-?\d*\.?\d*$/.test(raw)) {
        return;
      }

      setDraft(raw);

      if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;

      const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
      if (Number.isNaN(parsed)) return;
      onValueChange(clamp(parsed));
    };

    const commitDraft = () => {
      if (draft === null) return;
      if (draft === '' || draft === '-' || draft === '.' || draft === '-.') {
        onValueChange(min !== undefined ? min : 0);
      } else {
        const parsed = integer ? parseInt(draft, 10) : parseFloat(draft);
        if (!Number.isNaN(parsed)) onValueChange(clamp(parsed));
      }
      setDraft(null);
    };

    return (
      <Input
        ref={ref}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        value={displayValue}
        onChange={handleChange}
        onFocus={(e) => {
          setDraft(String(value));
          requestAnimationFrame(() => e.target.select());
          onFocus?.(e);
        }}
        onBlur={(e) => {
          commitDraft();
          onBlur?.(e);
        }}
        className={cn(className)}
        {...props}
      />
    );
  },
);
NumericInput.displayName = 'NumericInput';
