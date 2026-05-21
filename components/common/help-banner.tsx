import { cn } from "@/lib/utils";
import { Lightbulb, X } from "lucide-react";

interface HelpBannerProps {
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function HelpBanner({ children, onDismiss, className }: HelpBannerProps) {
  return (
    <div className={cn(
      "flex items-start gap-3 p-3 rounded-lg bg-[#fef3c7] border border-[#fcd34d]",
      className
    )}>
      <Lightbulb className="w-5 h-5 text-[#92400e] shrink-0 mt-0.5" />
      <p className="text-sm text-[#92400e] flex-1">{children}</p>
      {onDismiss && (
        <button 
          onClick={onDismiss}
          className="text-[#92400e] hover:text-[#78350f] shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
