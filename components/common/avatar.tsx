import { cn } from "@/lib/utils";
import { getInitials, getAvatarColor } from "@/lib/mock-data";

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
};

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const initials = getInitials(name);
  const bgColor = getAvatarColor(name);

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white shrink-0",
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: bgColor }}
    >
      {initials}
    </div>
  );
}

// Алиас — некоторые компоненты импортируют как UserAvatar
export const UserAvatar = Avatar;
