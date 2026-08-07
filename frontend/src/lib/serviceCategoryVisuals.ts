import {
  BedDouble,
  Beer,
  ChefHat,
  Coffee,
  IceCream,
  Layers,
  Package,
  Pizza,
  Shirt,
  ShoppingBag,
  Sparkles,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';

export type ServiceCategoryIconKey =
  | 'utensils-crossed'
  | 'coffee'
  | 'wine'
  | 'shirt'
  | 'sparkles'
  | 'package'
  | 'bed-double'
  | 'shopping-bag'
  | 'layers'
  | 'chef-hat'
  | 'ice-cream'
  | 'pizza'
  | 'beer';

export interface ServiceCategoryIconOption {
  key: ServiceCategoryIconKey;
  label: string;
  icon: LucideIcon;
  swatchClassName: string;
}

export const SERVICE_CATEGORY_ICON_OPTIONS: ServiceCategoryIconOption[] = [
  {
    key: 'utensils-crossed',
    label: 'Food',
    icon: UtensilsCrossed,
    swatchClassName: 'bg-orange-100 text-orange-600 ring-orange-200/70',
  },
  {
    key: 'coffee',
    label: 'Cafe',
    icon: Coffee,
    swatchClassName: 'bg-amber-100 text-amber-700 ring-amber-200/70',
  },
  {
    key: 'wine',
    label: 'Drinks',
    icon: Wine,
    swatchClassName: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200/70',
  },
  {
    key: 'beer',
    label: 'Bar',
    icon: Beer,
    swatchClassName: 'bg-yellow-100 text-yellow-700 ring-yellow-200/70',
  },
  {
    key: 'pizza',
    label: 'Fast Food',
    icon: Pizza,
    swatchClassName: 'bg-red-100 text-red-600 ring-red-200/70',
  },
  {
    key: 'ice-cream',
    label: 'Dessert',
    icon: IceCream,
    swatchClassName: 'bg-pink-100 text-pink-600 ring-pink-200/70',
  },
  {
    key: 'shirt',
    label: 'Laundry',
    icon: Shirt,
    swatchClassName: 'bg-cyan-100 text-cyan-700 ring-cyan-200/70',
  },
  {
    key: 'sparkles',
    label: 'Wellness',
    icon: Sparkles,
    swatchClassName: 'bg-violet-100 text-violet-700 ring-violet-200/70',
  },
  {
    key: 'bed-double',
    label: 'Rooms',
    icon: BedDouble,
    swatchClassName: 'bg-indigo-100 text-indigo-700 ring-indigo-200/70',
  },
  {
    key: 'chef-hat',
    label: 'Service',
    icon: ChefHat,
    swatchClassName: 'bg-emerald-100 text-emerald-700 ring-emerald-200/70',
  },
  {
    key: 'layers',
    label: 'Bundles',
    icon: Layers,
    swatchClassName: 'bg-sky-100 text-sky-700 ring-sky-200/70',
  },
  {
    key: 'package',
    label: 'Stock',
    icon: Package,
    swatchClassName: 'bg-slate-200 text-slate-700 ring-slate-300/70',
  },
  {
    key: 'shopping-bag',
    label: 'Retail',
    icon: ShoppingBag,
    swatchClassName: 'bg-rose-100 text-rose-700 ring-rose-200/70',
  },
];

const serviceCategoryIconOptionsMap = new Map(
  SERVICE_CATEGORY_ICON_OPTIONS.map((option) => [option.key, option])
);

export function getServiceCategoryIconOption(iconName?: string | null) {
  return (
    (iconName ? serviceCategoryIconOptionsMap.get(iconName as ServiceCategoryIconKey) : undefined) ||
    serviceCategoryIconOptionsMap.get('sparkles')!
  );
}

export function getServiceCategoryIconComponent(iconName?: string | null) {
  return getServiceCategoryIconOption(iconName).icon;
}
