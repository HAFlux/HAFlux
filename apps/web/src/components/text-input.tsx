import clsx from 'clsx';
import { type InputHTMLAttributes, forwardRef } from 'react';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          'border-separator bg-background text-foreground placeholder:text-muted',
          'focus:border-foreground focus:ring-foreground/30',
          'h-10 w-full rounded-md border px-3 text-sm transition-colors duration-150',
          'focus:outline-hidden focus:ring-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
