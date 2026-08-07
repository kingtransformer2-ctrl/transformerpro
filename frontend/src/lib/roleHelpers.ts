import { Shield, Users, Briefcase, UserCheck, UserCog, ShoppingCart, Building } from "lucide-react";

// Shared icon map for role display
export const roleIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  Users,
  Briefcase,
  UserCheck,
  UserCog,
  ShoppingCart,
  Building,
};

export function getIconComponent(iconName: string | null) {
  return roleIconMap[iconName || 'Shield'] || Shield;
}

export function getRoleColorClass(color: string | null): string {
  const colorMap: Record<string, string> = {
    destructive: 'text-destructive',
    secondary: 'text-primary',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-orange-600 dark:text-orange-400',
    purple: 'text-purple-600 dark:text-purple-400',
    default: 'text-muted-foreground',
  };
  return colorMap[color || 'default'] || 'text-muted-foreground';
}

export function getBadgeVariant(color: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (color === 'destructive') return 'destructive';
  if (color === 'secondary') return 'secondary';
  return 'outline';
}
