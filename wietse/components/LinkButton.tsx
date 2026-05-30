import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type LinkButtonProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
  };

export function LinkButton({
  className,
  variant,
  size,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
