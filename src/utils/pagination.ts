export const DEFAULT_ITEMS_PER_PAGE = 12;
export const MIN_ITEMS_PER_PAGE = 1;
export const MAX_ITEMS_PER_PAGE = 50;

export const normalizeItemsPerPage = (value?: number | null): number => {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_ITEMS_PER_PAGE;
  }

  const safeValue = Math.trunc(value);
  if (safeValue < MIN_ITEMS_PER_PAGE) return MIN_ITEMS_PER_PAGE;
  if (safeValue > MAX_ITEMS_PER_PAGE) return MAX_ITEMS_PER_PAGE;
  return safeValue;
};

export const getPaginatedItems = <T>(items: T[], itemsPerPage?: number): T[][] => {
  const pageSize = normalizeItemsPerPage(itemsPerPage);
  if (!items.length) return [];

  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }
  return pages;
};
