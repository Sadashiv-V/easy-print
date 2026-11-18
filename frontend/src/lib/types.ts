export interface User {
  id: string;
  college_id: string;
  full_name: string;
  role: 'student' | 'admin';
  status: 'active' | 'blocked';
  created_at: string;
}

export type UserAdmin = User & {
  blocked_reason: string | null;
  last_login_at: string | null;
};

export interface Doc {
  id: string;
  original_name: string;
  size_bytes: number;
  page_count: number;
  color_mode: 'bw' | 'color';
  duplex: boolean;
  copies: number;
  page_ranges: string;
  selected_pages: number;
  rate_paise_per_page: number;
  estimated_price_paise: number;
  created_at: string;
  expires_at: string;
}

export interface Pricing {
  id: string;
  bw_paise_per_page: number;
  color_paise_per_page: number;
  created_at: string;
}

export interface PricingHistory extends Pricing {
  created_by: string;
  reason: string;
}

export interface Wallet {
  balance_paise: number;
  held_paise: number;
}

export interface Entry {
  id: string;
  kind: 'recharge' | 'hold' | 'capture' | 'release' | 'refund' | 'adjustment';
  amount_paise: number;
  balance_after_paise: number;
  hold_id: string | null;
  reference: string | null;
  note: string | null;
  created_at: string;
}

export interface Recharge {
  id: string;
  user_id: string;
  amount_paise: number;
  reference: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface RechargeAdmin extends Recharge {
  college_id: string;
  full_name: string;
}

export interface JobItem {
  document_id: string;
  document_name: string;
  copies: number;
  color_mode: 'bw' | 'color';
  duplex: boolean;
  page_ranges: string;
  selected_pages: number;
  price_paise: number;
  status: 'queued' | 'printing' | 'done' | 'completed' | 'failed' | 'cancelled';
}

export interface Job {
  id: string;
  status: 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled' | 'partial';
  station_id: string;
  station_name?: string;
  total_paise: number;
  failure_reason: string | null;
  created_at: string;
  finished_at: string | null;
  items: JobItem[];
}

export interface Station {
  id: string;
  name: string;
  location: string | null;
  status: 'active' | 'inactive';
  last_seen_at: string | null;
  in_use: boolean;
  printer_status: 'unknown' | 'online' | 'offline' | 'no_paper' | 'error';
  printer_message: string | null;
  printer_status_at: string | null;
  printer_ok: boolean;
  agent_configured: boolean;
}

export type StationWithKey = Station & {
  station_key: string;
  agent_key: string | null;
};

export interface AdminWallet extends Wallet {
  user_id: string;
  college_id: string;
  full_name: string;
  entries: Entry[];
}

export interface Reconcile {
  wallets_checked: number;
  mismatch_count: number;
  total_balance_paise: number;
  total_held_paise: number;
}

export interface Audit {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name?: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  ip: string | null;
}

export interface StationUser {
  college_id: string;
  full_name: string;
  balance_paise: number;
  held_paise: number;
  session_expires_at: string;
  idle_timeout_seconds: number;
}

export interface QuoteLine {
  document_id: string;
  original_name: string;
  copies: number;
  selected_pages: number;
  color_mode: 'bw' | 'color';
  duplex: boolean;
  rate_paise_per_page: number;
  price_paise: number;
}

export interface Quote {
  lines: QuoteLine[];
  total_pages: number;
  total_paise: number;
  balance_paise: number;
  sufficient: boolean;
  shortfall_paise: number;
}

export interface PrinterState {
  printer_available: boolean;
  printer_status: 'unknown' | 'online' | 'offline' | 'no_paper' | 'error';
  message: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}