import {
  Audit, Doc, Entry, Job, PrinterState, Pricing, PricingHistory, Quote, Reconcile, Recharge,
  RechargeAdmin, Station, StationUser, StationWithKey, User, UserAdmin, Wallet, AdminWallet, ApiError,
} from './types';

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8000' : '/api')).replace(/\/$/, '');
const TOKEN_KEY = 'easyprint_token';
const STATION_KEY = 'easyprint_station_key';

let kioskToken: string | null = null;
let kioskUser: StationUser | null = null;

// ---------- plumbing ----------

// Backend ids are numbers; the UI works with string ids.
function stringifyIds<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => stringifyIds(x)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = (k === 'id' || k.endsWith('_id')) && typeof val === 'number' ? String(val) : stringifyIds(val);
    }
    return out as T;
  }
  return v as T;
}
const num = (id: string | number) => Number(id);

function messageFrom(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : '';
    const msg = (first.msg || 'Invalid input').replace(/^Value error, /, '');
    return field && field !== 'body' ? `${field.replace(/_/g, ' ')}: ${msg}` : msg;
  }
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on the server. Please try again.';
  return 'Request failed.';
}

type Scope = 'user' | 'station' | 'none';
interface Opts { method?: string; json?: unknown; form?: FormData | URLSearchParams; scope?: Scope; }

async function call<T>(path: string, o: Opts = {}): Promise<T> {
  const scope = o.scope ?? 'user';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
  else if (o.form) body = o.form;

  if (scope === 'user') {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) headers.Authorization = `Bearer ${t}`;
  } else if (scope === 'station') {
    const k = localStorage.getItem(STATION_KEY);
    if (k) headers['X-Station-Key'] = k;
    if (kioskToken) headers['X-Station-Session'] = kioskToken;
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, { method: o.method || (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = res.status === 204 ? null : isJson ? await res.json().catch(() => null) : await res.blob().catch(() => null);

  if (!res.ok) {
    if (res.status === 401) {
      if (scope === 'user' && localStorage.getItem(TOKEN_KEY)) {
        localStorage.removeItem(TOKEN_KEY);
        window.dispatchEvent(new Event('easyprint:unauthorized'));
      }
      if (scope === 'station' && kioskToken) {
        kioskToken = null; kioskUser = null;
        window.dispatchEvent(new Event('easyprint:kiosk-expired'));
      }
    }
    throw new ApiError(res.status, messageFrom(data, res.status));
  }
  return (isJson ? stringifyIds<T>(data) : data) as T;
}

const get = <T>(p: string, scope?: Scope) => call<T>(p, { scope });
const post = <T>(p: string, json: unknown = {}, scope?: Scope) => call<T>(p, { method: 'POST', json, scope });
const patch = <T>(p: string, json: unknown) => call<T>(p, { method: 'PATCH', json });
const del = <T>(p: string) => call<T>(p, { method: 'DELETE' });
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
// The backend returns plain lists. Report a total that is exact on the last page
// and one-more-than-shown otherwise, so "show more" and page buttons work.
const approxTotal = (offset: number, len: number, limit: number) => offset + len + (len >= limit ? 1 : 0);

// ---------- session helpers (kept for the UI) ----------

export function getStoredSession(): User | null { return null; }
export function setStoredSession(_u: User | null): void { /* the token is the session */ }
export function getStoredKioskSession(): StationUser | null { return kioskUser; }
export function setStoredKioskSession(u: StationUser | null): void { kioskUser = u; }

// ---------- auth & student ----------

export async function login(collegeId: string, password: string): Promise<User> {
  const form = new URLSearchParams({ username: collegeId.trim(), password });
  const out = await call<{ access_token: string }>('/auth/login', { form, scope: 'none' });
  localStorage.setItem(TOKEN_KEY, out.access_token);
  return me();
}

export async function me(): Promise<User> {
  if (!localStorage.getItem(TOKEN_KEY)) throw new ApiError(401, 'Please sign in.');
  return get<User>('/auth/me');
}

export async function logout(): Promise<void> { localStorage.removeItem(TOKEN_KEY); }

export async function register(data: { college_id: string; activation_code: string; password: string; station_pin: string }): Promise<User> {
  return call<User>('/auth/register', { method: 'POST', json: { ...data, college_id: data.college_id.trim().toUpperCase() }, scope: 'none' });
}

export async function changePassword(current: string, next: string): Promise<{ success: boolean }> {
  const out = await post<{ access_token?: string }>('/auth/change-password', { current_password: current, new_password: next });
  if (out?.access_token) localStorage.setItem(TOKEN_KEY, out.access_token);
  return { success: true };
}

export async function changeStationPin(password: string, newPin: string): Promise<{ success: boolean }> {
  await post('/auth/change-station-pin', { password, new_pin: newPin });
  return { success: true };
}

export const listDocuments = () => get<Doc[]>('/documents');

export async function uploadDocument(file: File, settings?: Partial<Doc>): Promise<Doc> {
  const form = new FormData();
  form.append('file', file);
  form.append('color_mode', settings?.color_mode ?? 'bw');
  form.append('duplex', String(settings?.duplex ?? false));
  form.append('copies', String(settings?.copies ?? 1));
  form.append('page_ranges', (settings?.page_ranges || 'all').trim() || 'all');
  return call<Doc>('/documents', { form });
}

export function updateDocumentSettings(id: string, partial: Partial<Doc>): Promise<Doc> {
  const { color_mode, duplex, copies, page_ranges } = partial;
  return patch<Doc>(`/documents/${num(id)}/settings`, {
    color_mode, duplex, copies, page_ranges: page_ranges === undefined ? undefined : page_ranges.trim() || 'all',
  });
}

export async function deleteDocument(id: string): Promise<{ success: boolean }> { await del(`/documents/${num(id)}`); return { success: true }; }

export async function previewDocument(id: string): Promise<{ url: string; page_count: number }> {
  const blob = await call<Blob>(`/documents/${num(id)}/file`);
  return { url: URL.createObjectURL(blob), page_count: 0 };
}

export const getPricing = () => get<Pricing>('/pricing');
export const getWallet = () => get<Wallet>('/wallet');

export async function listEntries(limit = 20, offset = 0): Promise<{ entries: Entry[]; total: number }> {
  const entries = await get<Entry[]>(`/wallet/entries${qs({ limit, offset })}`);
  return { entries, total: approxTotal(offset, entries.length, limit) };
}

export const createRecharge = (d: { amount_paise: number; reference: string; note?: string | null }) =>
  post<Recharge>('/wallet/recharge-requests', { amount_paise: d.amount_paise, reference: d.reference.trim(), note: d.note || null });
export const listMyRecharges = () => get<Recharge[]>('/wallet/recharge-requests');
export const cancelRecharge = (id: string) => post<Recharge>(`/wallet/recharge-requests/${num(id)}/cancel`);
export const listMyJobs = (limit = 20) => get<Job[]>(`/jobs${qs({ limit })}`);

// ---------- admin ----------

export async function listRecharges(status?: string, limit = 20, offset = 0): Promise<{ recharges: RechargeAdmin[]; total: number }> {
  const recharges = await get<RechargeAdmin[]>(`/admin/recharge-requests${qs({ status, limit, offset })}`);
  return { recharges, total: approxTotal(offset, recharges.length, limit) };
}
export const approveRecharge = (id: string, note?: string) => post<RechargeAdmin>(`/admin/recharge-requests/${num(id)}/approve`, { note: note || null });
export const rejectRecharge = (id: string, note: string) => post<RechargeAdmin>(`/admin/recharge-requests/${num(id)}/reject`, { note });

export async function listUsers(search = '', limit = 20, offset = 0): Promise<{ users: UserAdmin[]; total: number }> {
  const users = await get<UserAdmin[]>(`/admin/users${qs({ search: search.trim(), limit: Math.min(limit, 100), offset })}`);
  return { users, total: approxTotal(offset, users.length, limit) };
}
export const blockUser = (id: string, reason: string) => post<UserAdmin>(`/admin/users/${num(id)}/block`, { reason });
export const unblockUser = (id: string, reason: string) => post<UserAdmin>(`/admin/users/${num(id)}/unblock`, { reason });
export const getAdminWallet = (userId: string) => get<AdminWallet>(`/admin/wallets/${num(userId)}`);

export async function adjustWallet(userId: string, d: { amount_paise: number; kind: 'recharge' | 'adjustment' | 'refund'; reason: string }): Promise<AdminWallet> {
  await post(`/admin/wallets/${num(userId)}/adjust`, {
    amount_paise: d.amount_paise, kind: d.kind === 'recharge' ? 'recharge' : 'adjustment', reason: d.reason.trim(),
    idempotency_key: crypto.randomUUID().replace(/-/g, ''),
  });
  return getAdminWallet(userId);
}
export async function refundHold(holdId: string, reason: string): Promise<{ success: boolean }> {
  await post(`/admin/holds/${num(holdId)}/refund`, { reason });
  return { success: true };
}
export const reconcile = () => get<Reconcile>('/admin/wallet-reconcile');

const withKeys = (s: Station, extra: Partial<StationWithKey> = {}): StationWithKey => ({ station_key: '', agent_key: null, ...s, ...extra });
export async function listStations(): Promise<StationWithKey[]> { return (await get<Station[]>('/admin/stations')).map((s) => withKeys(s)); }
export async function createStation(d: { name: string; location?: string | null }): Promise<StationWithKey> {
  return post<StationWithKey>('/admin/stations', { name: d.name.trim(), location: d.location?.trim() || null });
}
export async function setStationActive(id: string, active: boolean, reason?: string): Promise<StationWithKey> {
  const s = await post<Station>(`/admin/stations/${num(id)}/${active ? 'activate' : 'deactivate'}`, { reason: reason || (active ? 'Switched on by admin' : 'Switched off by admin') });
  return withKeys(s);
}
export async function rotateStationKey(id: string, reason: string): Promise<StationWithKey> {
  return withKeys(await post<Station & { station_key: string }>(`/admin/stations/${num(id)}/rotate-key`, { reason }));
}
export async function rotateAgentKey(id: string, reason: string): Promise<StationWithKey> {
  const out = await post<Station & { agent_key: string }>(`/admin/stations/${num(id)}/rotate-agent-key`, { reason });
  return withKeys(out, { station_key: '', agent_key: out.agent_key });
}

export async function verifyOtp(collegeId: string, otp: string): Promise<void> {
  await post('/auth/verify-otp', { college_id: collegeId.trim().toUpperCase(), otp });
}
export async function setPricing(d: { bw: number; color: number; reason: string }): Promise<Pricing> {
  return post<Pricing>('/admin/pricing', { bw_paise_per_page: d.bw, color_paise_per_page: d.color, reason: d.reason.trim() });
}
export const pricingHistory = () => get<PricingHistory[]>('/admin/pricing/history?limit=30');
export const listAudit = (limit = 50) => get<Audit[]>(`/admin/audit${qs({ limit: Math.min(limit, 200) })}`);
export async function verifyAudit(): Promise<{ verified: boolean; count: number; checksum: string }> {
  const r = await get<{ ok: boolean; entries_checked: number }>('/admin/audit/verify');
  return { verified: r.ok, count: r.entries_checked, checksum: '' };
}

export const adminResetPassword = (id: string, newPassword: string) =>
  post<UserAdmin>(`/admin/users/${num(id)}/reset-password`, { new_password: newPassword });

export async function forgotPassword(collegeId: string): Promise<void> {
  await post('/auth/forgot-password', { college_id: collegeId.trim().toUpperCase() });
}

export async function resetPassword(collegeId: string, otp: string, newPassword: string): Promise<void> {
  await post('/auth/reset-password', { college_id: collegeId.trim().toUpperCase(), otp, new_password: newPassword });
}
// ---------- kiosk ----------

export const getStationKey = () => localStorage.getItem(STATION_KEY);
export function setStationKey(key: string) { localStorage.setItem(STATION_KEY, key.trim()); }
export function clearStationKey() { localStorage.removeItem(STATION_KEY); kioskToken = null; kioskUser = null; }

export const stationStatus = () => get<PrinterState>('/station/status', 'station');

export async function stationLogin(collegeId: string, pin: string): Promise<StationUser> {
  const out = await post<StationUser & { session_token: string }>('/station/login', { college_id: collegeId.trim().toUpperCase(), pin }, 'station');
  const { session_token, ...user } = out;
  kioskToken = session_token; kioskUser = user;
  return user;
}

export async function stationMe(): Promise<StationUser | null> {
  if (!kioskToken) return null;
  try { kioskUser = await get<StationUser>('/station/me', 'station'); return kioskUser; } catch { return null; }
}

let lastPing = 0;
export function stationPing() {
  if (!kioskToken || Date.now() - lastPing < 15000) return;
  lastPing = Date.now();
  stationMe();
}

export async function stationLogout(): Promise<void> {
  try { if (kioskToken) await post('/station/logout', {}, 'station'); } catch { /* already ended */ }
  kioskToken = null; kioskUser = null;
}

export const stationDocuments = () => get<Doc[]>('/station/documents', 'station');
const lines = (items: Array<{ document_id: string; copies: number }>) => items.map((i) => ({ document_id: num(i.document_id), copies: i.copies }));
export const stationQuote = (items: Array<{ document_id: string; copies: number }>) => post<Quote>('/station/quote', { items: lines(items) }, 'station');
export const stationPrint = (items: Array<{ document_id: string; copies: number }>, idempotencyKey: string) =>
  post<Job>('/station/print', { items: lines(items), idempotency_key: idempotencyKey }, 'station');
export const stationJobs = () => get<Job[]>('/station/jobs', 'station');
export const stationCancelJob = (id: string) => post<Job>(`/station/jobs/${num(id)}/cancel`, {}, 'station');