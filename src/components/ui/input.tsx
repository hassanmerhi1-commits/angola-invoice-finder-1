import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    const handleWheel = React.useCallback((e: React.WheelEvent<HTMLInputElement>) => {
      if (type === 'number') {
        (e.target as HTMLInputElement).blur();
        return;
      }
      onWheel?.(e);
    }, [type, onWheel]);

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-0 text-base leading-none ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onWheel={handleWheel}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
