import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-neutral-800 text-neutral-300",
        outline: "border border-neutral-700 text-neutral-500",
        success: "bg-emerald-900/60 text-emerald-300",
        warning: "bg-amber-900/60 text-amber-300",
        secondary: "bg-white/90 text-black",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ variant, className }))}
      data-slot="badge"
      {...props}
    />
  );
}

export { Badge, badgeVariants };
