import { cn } from '@/lib/utils';
import { getServiceCategoryIconOption } from '@/lib/serviceCategoryVisuals';

interface ServiceCategoryVisualProps {
  imageUrl?: string | null;
  iconName?: string | null;
  label?: string;
  className?: string;
  imageClassName?: string;
  iconClassName?: string;
}

export function ServiceCategoryVisual({
  imageUrl,
  iconName,
  label,
  className,
  imageClassName,
  iconClassName,
}: ServiceCategoryVisualProps) {
  const iconOption = getServiceCategoryIconOption(iconName);
  const Icon = iconOption.icon;

  return (
    <div
      className={cn(
        'overflow-hidden',
        imageUrl ? 'bg-slate-100' : iconOption.swatchClassName,
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={label || 'Category image'}
          loading="lazy"
          decoding="async"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          className={cn('h-full w-full object-cover', imageClassName)}
        />
      ) : (
        <Icon className={cn('h-4 w-4', iconClassName)} />
      )}
    </div>
  );
}
