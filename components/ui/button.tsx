"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#2563eb] text-white hover:bg-[#1d4ed8]",
        destructive: "bg-[#dc2626] text-white hover:bg-[#b91c1c]",
        outline: "border border-[#e3e6eb] bg-white text-[#1f2328] hover:bg-[#f9fafb]",
        secondary: "bg-[#f3f4f6] text-[#1f2328] hover:bg-[#e5e7eb]",
        ghost: "text-[#1f2328] hover:bg-[#f3f4f6]",
        link: "text-[#2563eb] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-4",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
