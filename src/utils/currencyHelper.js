import settingsStore from './settingsStore.js';

// Currency symbol map
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  PHP: '₱',
  CHF: 'CHF',
  SGD: 'S$',
  MXN: 'MX$',
  BRL: 'R$',
  ZAR: 'R',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  NZD: 'NZ$',
  HKD: 'HK$'
};

/**
 * Get the currency symbol for a given currency code
 * @param {string} currencyCode - The currency code (e.g., 'USD', 'PHP')
 * @returns {string} The currency symbol
 */
export function getCurrencySymbol(currencyCode) {
  return CURRENCY_SYMBOLS[currencyCode] || '$';
}

/**
 * Format a price with the appropriate currency symbol
 * @param {number} amount - The amount to format
 * @param {string} currencyCode - The currency code
 * @returns {string} Formatted price string
 */
export function formatPrice(amount, currencyCode) {
  const symbol = getCurrencySymbol(currencyCode);
  const formatted = Number(amount || 0).toFixed(2);
  return `${symbol}${formatted}`;
}

/**
 * Get the current store currency code from settings
 * @returns {Promise<string>} The currency code
 */
export async function getCurrentCurrency() {
  const code = await settingsStore.getSetting('currency_code');
  return code || 'USD';
}

/**
 * Get currency data for use in views
 * @returns {Promise<{code: string, symbol: string}>}
 */
export async function getCurrencyData() {
  const code = await getCurrentCurrency();
  const symbol = getCurrencySymbol(code);
  return { code, symbol };
}

export default {
  getCurrencySymbol,
  formatPrice,
  getCurrentCurrency,
  getCurrencyData
};
