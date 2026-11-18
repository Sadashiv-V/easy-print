/**
 * Format paise into Indian Rupees (₹) with 2 decimal places using en-IN locale
 */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function formatRupeesRaw(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** The server sends UTC times without a 'Z'. Without it the browser would read them as local time (5.5 hours off in India). */
export function parseServerDate(iso: string): Date {
  return new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = parseServerDate(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(d);
  } catch {
    return isoString;
  }
}

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = parseServerDate(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return isoString;
  }
}

export function daysLeftUntil(isoString: string | null | undefined): number {
  if (!isoString) return 0;
  try {
    const target = parseServerDate(isoString).getTime();
    const now = Date.now();
    const diff = target - now;
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Parses page range string such as "1-3, 5, 7-9" given a total page count
 * Returns { valid: boolean, selectedCount: number, error?: string }
 */
export function parsePageRange(rangeStr: string, totalPages: number): {
  valid: boolean;
  selectedCount: number;
  pages: number[];
  error?: string;
} {
  const trimmed = rangeStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    return { valid: true, selectedCount: totalPages, pages };
  }

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  const selectedSet = new Set<number>();

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map((s) => s.trim());
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
        return {
          valid: false,
          selectedCount: 0,
          pages: [],
          error: `Invalid range "${part}". Use format like "1-5".`,
        };
      }
      if (start > totalPages) {
        return {
          valid: false,
          selectedCount: 0,
          pages: [],
          error: `Page ${start} exceeds total document pages (${totalPages}).`,
        };
      }
      const cappedEnd = Math.min(end, totalPages);
      for (let p = start; p <= cappedEnd; p++) {
        selectedSet.add(p);
      }
    } else {
      const page = parseInt(part, 10);
      if (isNaN(page) || page < 1) {
        return {
          valid: false,
          selectedCount: 0,
          pages: [],
          error: `Invalid page number "${part}".`,
        };
      }
      if (page > totalPages) {
        return {
          valid: false,
          selectedCount: 0,
          pages: [],
          error: `Page ${page} exceeds total document pages (${totalPages}).`,
        };
      }
      selectedSet.add(page);
    }
  }

  const pages = Array.from(selectedSet).sort((a, b) => a - b);
  return {
    valid: pages.length > 0,
    selectedCount: pages.length,
    pages,
    error: pages.length === 0 ? 'No pages selected' : undefined,
  };
}

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
}

/** Same rules as the server. Returns a message, or null when the password is fine. */
export function passwordProblem(password: string, collegeId = ''): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (collegeId && password.toLowerCase().includes(collegeId.trim().toLowerCase())) return 'Password must not contain your College ID.';
  if (new Set(password).size < 4) return 'Password is too repetitive. Use more different characters.';
  return null;
}

/** Same rules as the server. Returns a message, or null when the PIN is fine. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'Station PIN must be 4 to 6 digits.';
  const steps = new Set<number>();
  for (let i = 1; i < pin.length; i++) steps.add(Number(pin[i]) - Number(pin[i - 1]));
  if (new Set(pin).size === 1 || (steps.size === 1 && (steps.has(1) || steps.has(-1)))) {
    return 'That PIN is too easy to guess (like 1111 or 1234). Choose a different one.';
  }
  return null;
}

export const PRINTER_LABEL: Record<string, string> = {
  online: 'Online',
  unknown: 'No report yet',
  offline: 'Offline',
  no_paper: 'Out of paper',
  error: 'Error',
};

/** What an admin should read about a station's printer, without pretending to know more than the print agent reported. */
export function printerNote(s: { printer_status: string; printer_message: string | null; agent_configured: boolean }): string {
  if (s.printer_message) return s.printer_message;
  if (s.printer_status === 'online') return 'The print agent reports the printer is ready.';
  if (s.printer_status === 'unknown') {
    return s.agent_configured ? 'The print agent has not reported yet. Is it running on the station PC?' : 'The print agent has not been set up for this station yet.';
  }
  return PRINTER_LABEL[s.printer_status] || s.printer_status;
}