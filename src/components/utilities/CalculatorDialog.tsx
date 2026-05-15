import { useReducer, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Op = '+' | '-' | '*' | '/';

type CalcState = {
  display: string;
  accumulator: number | null;
  pendingOp: Op | null;
  waitingForOperand: boolean;
};

const initialState = (): CalcState => ({
  display: '0',
  accumulator: null,
  pendingOp: null,
  waitingForOperand: false,
});

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? Number.NaN : a / b;
    default:
      return b;
  }
}

function formatDisplay(n: number): string {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

type CalcAction =
  | { type: 'DIGIT'; d: string }
  | { type: 'OP'; op: Op }
  | { type: 'EQUALS' }
  | { type: 'CLEAR' };

function reducer(state: CalcState, action: CalcAction): CalcState {
  switch (action.type) {
    case 'CLEAR':
      return initialState();
    case 'DIGIT': {
      const d = action.d;
      if (state.display === 'Error') return initialState();
      if (state.waitingForOperand) {
        return {
          ...state,
          display: d === '.' ? '0.' : d,
          waitingForOperand: false,
        };
      }
      if (d === '.' && state.display.includes('.')) return state;
      if (state.display === '0' && d !== '.') return { ...state, display: d };
      return { ...state, display: state.display + d };
    }
    case 'OP': {
      if (state.display === 'Error') return initialState();
      const op = action.op;
      const inputValue = parseFloat(state.display);
      if (Number.isNaN(inputValue)) return initialState();

      if (state.accumulator == null) {
        return { ...state, accumulator: inputValue, pendingOp: op, waitingForOperand: true };
      }

      if (state.pendingOp && !state.waitingForOperand) {
        const result = compute(state.accumulator, inputValue, state.pendingOp);
        if (!Number.isFinite(result)) {
          return { ...initialState(), display: 'Error' };
        }
        return {
          accumulator: result,
          pendingOp: op,
          display: formatDisplay(result),
          waitingForOperand: true,
        };
      }

      return { ...state, pendingOp: op, waitingForOperand: true };
    }
    case 'EQUALS': {
      if (state.display === 'Error') return initialState();
      if (state.pendingOp == null || state.accumulator == null) return state;
      const inputValue = parseFloat(state.display);
      if (Number.isNaN(inputValue)) return initialState();
      const result = compute(state.accumulator, inputValue, state.pendingOp);
      if (!Number.isFinite(result)) {
        return { ...initialState(), display: 'Error' };
      }
      return {
        display: formatDisplay(result),
        accumulator: null,
        pendingOp: null,
        waitingForOperand: true,
      };
    }
    default:
      return state;
  }
}

interface CalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}

export function CalculatorDialog({ open, onOpenChange, title }: CalculatorDialogProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    if (!open) dispatch({ type: 'CLEAR' });
  }, [open]);

  const key = (label: string, action: CalcAction, variant: 'default' | 'outline' | 'secondary' = 'outline') => (
    <Button
      type="button"
      variant={variant}
      className="h-11 text-sm font-semibold"
      onClick={() => dispatch(action)}
    >
      {label}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[280px] gap-3 p-4">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 px-3 py-3 text-right font-mono text-2xl font-semibold tracking-tight tabular-nums min-h-[3rem] flex items-center justify-end">
          {state.display}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {key('C', { type: 'CLEAR' }, 'secondary')}
          <div className="col-span-2" aria-hidden />
          {key('÷', { type: 'OP', op: '/' })}
          {key('7', { type: 'DIGIT', d: '7' })}
          {key('8', { type: 'DIGIT', d: '8' })}
          {key('9', { type: 'DIGIT', d: '9' })}
          {key('×', { type: 'OP', op: '*' })}
          {key('4', { type: 'DIGIT', d: '4' })}
          {key('5', { type: 'DIGIT', d: '5' })}
          {key('6', { type: 'DIGIT', d: '6' })}
          {key('−', { type: 'OP', op: '-' })}
          {key('1', { type: 'DIGIT', d: '1' })}
          {key('2', { type: 'DIGIT', d: '2' })}
          {key('3', { type: 'DIGIT', d: '3' })}
          {key('+', { type: 'OP', op: '+' })}
          <Button
            type="button"
            variant="outline"
            className="col-span-2 h-11 text-sm font-semibold"
            onClick={() => dispatch({ type: 'DIGIT', d: '0' })}
          >
            0
          </Button>
          {key('.', { type: 'DIGIT', d: '.' })}
          {key('=', { type: 'EQUALS' }, 'default')}
        </div>
      </DialogContent>
    </Dialog>
  );
}
