import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm text-neutral-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
