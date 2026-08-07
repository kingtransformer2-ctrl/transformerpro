export function normalizeServiceCategoryName(value?: string | null, fallback = 'other') {
  const normalized = (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

export function formatServiceCategoryLabel(value?: string | null, fallback = 'Other') {
  const normalized = normalizeServiceCategoryName(value, '');
  if (!normalized) return fallback;

  return normalized
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inferServiceCategoryIcon(value?: string | null) {
  const normalized = normalizeServiceCategoryName(value);

  if (/(pizza|burger|fries|fast-food|takeaway)/.test(normalized)) {
    return 'pizza';
  }

  if (/(dessert|ice-cream|gelato|cake|sweet|pastry)/.test(normalized)) {
    return 'ice-cream';
  }

  if (/(food|meal|breakfast|lunch|dinner|dish|grill|snack)/.test(normalized)) {
    return 'utensils-crossed';
  }

  if (/(coffee|tea|espresso|cafe)/.test(normalized)) {
    return 'coffee';
  }

  if (/(beer|brew|pub|alcohol)/.test(normalized)) {
    return 'beer';
  }

  if (/(drink|beverage|juice|water|soda|cocktail|bar|wine|minibar)/.test(normalized)) {
    return 'wine';
  }

  if (/(laundry|clean)/.test(normalized)) {
    return 'shirt';
  }

  if (/(spa|massage|beauty|wellness)/.test(normalized)) {
    return 'sparkles';
  }

  if (/(room|suite|accommodation|stay|bed)/.test(normalized)) {
    return 'bed-double';
  }

  if (/(service|concierge|chef|kitchen|housekeeping|support)/.test(normalized)) {
    return 'chef-hat';
  }

  if (/(inventory|stock|supply|package)/.test(normalized)) {
    return 'package';
  }

  if (/(retail|shop|gift|store|market)/.test(normalized)) {
    return 'shopping-bag';
  }

  if (/(combo|bundle|set|package-deal)/.test(normalized)) {
    return 'layers';
  }

  return 'sparkles';
}

export type ServiceStation = 'kitchen' | 'bar' | 'other';

export type CategoryStationLike = {
  name?: string | null;
  station?: ServiceStation | null;
};

export function inferServiceCategoryStation(value?: string | null): ServiceStation {
  const normalized = normalizeServiceCategoryName(value);

  if (/(drink|beverage|juice|water|soda|cocktail|bar|wine|minibar|coffee|tea|beer|alcohol)/.test(normalized)) {
    return 'bar';
  }

  if (/(food|meal|breakfast|lunch|dinner|dish|grill|snack|dessert|pizza|burger|fries|kitchen)/.test(normalized)) {
    return 'kitchen';
  }

  return 'other';
}

export function resolveServiceCategoryStation(
  categoryName?: string | null,
  categories: CategoryStationLike[] = [],
  fallback: Exclude<ServiceStation, 'other'> = 'kitchen'
): Exclude<ServiceStation, 'other'> {
  const normalizedCategory = normalizeServiceCategoryName(categoryName);
  const matchedCategory = categories.find(
    (category) => normalizeServiceCategoryName(category.name) === normalizedCategory
  );

  const resolvedStation = matchedCategory?.station || inferServiceCategoryStation(categoryName);
  return resolvedStation === 'other' ? fallback : resolvedStation;
}

export type ItemStationLike = {
  station?: ServiceStation | null;
  category?: string | null;
};

/**
 * Resolves the correct printer/station for an order item using three tiers,
 * most specific first:
 *   1. The item's own `station` field, if explicitly set to 'kitchen' or 'bar'.
 *   2. The category's `station` field (or name-based inference as a secondary
 *      check inside resolveServiceCategoryStation).
 *   3. A safe fallback ('kitchen' by default) so nothing is ever silently
 *      dropped or mis-routed to 'other' and printed nowhere.
 */
export function resolveItemStation(
  item: ItemStationLike,
  categories: CategoryStationLike[] = [],
  fallback: Exclude<ServiceStation, 'other'> = 'kitchen'
): Exclude<ServiceStation, 'other'> {
  if (item.station === 'kitchen' || item.station === 'bar') {
    return item.station;
  }
  return resolveServiceCategoryStation(item.category, categories, fallback);
}

export function normalizeLookupValue(value?: string | null) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
