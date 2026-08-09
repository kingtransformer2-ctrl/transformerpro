import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const STORAGE_PREFIX = 'apiClient.storage';

let currentSession: any = null;
let currentUser: any = null;
let authListeners: ((event: string, session: any) => void)[] = [];

type QueryState = {
  select: string;
  eq: Record<string, any>;
  in: Record<string, any[]>;
  gte: Record<string, any>;
  lte: Record<string, any>;
  gt: Record<string, any>;
  lt: Record<string, any>;
  is: Record<string, any>;
  order: Record<string, any>;
  limit?: number;
  single?: boolean;
};

const createInitialQueryState = (): QueryState => ({
  select: '*',
  eq: {},
  in: {},
  gte: {},
  lte: {},
  gt: {},
  lt: {},
  is: {},
  order: {},
});

const cloneQueryState = (query: QueryState): QueryState => ({
  select: query.select,
  eq: { ...query.eq },
  in: Object.fromEntries(Object.entries(query.in).map(([key, values]) => [key, [...values]])),
  gte: { ...query.gte },
  lte: { ...query.lte },
  gt: { ...query.gt },
  lt: { ...query.lt },
  is: { ...query.is },
  order: { ...query.order },
  limit: query.limit,
  single: query.single,
});

const normalizeUser = (payload: { userId: string; email: string; role?: string | null }) => ({
  id: payload.userId,
  email: payload.email,
  user_metadata: payload.role ? { role: payload.role } : {},
  app_metadata: payload.role ? { role: payload.role } : {},
});

const normalizeResultData = (data: any, single?: boolean) => {
  if (!single) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.length > 0 ? data[0] : null;
  }

  return data ?? null;
};

const getStoredToken = () => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

const getAuthHeaders = () => {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const createStorageKey = (bucket: string, path: string) => `${STORAGE_PREFIX}:${bucket}:${path}`;

const readStorageObject = (bucket: string, path: string): { publicUrl: string } | null => {
  try {
    const raw = localStorage.getItem(createStorageKey(bucket, path));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeStorageObject = (bucket: string, path: string, publicUrl: string) => {
  localStorage.setItem(createStorageKey(bucket, path), JSON.stringify({ publicUrl }));
};

const removeStorageObject = (bucket: string, path: string) => {
  localStorage.removeItem(createStorageKey(bucket, path));
};

const readBlobAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const loadSession = () => {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      currentUser = normalizeUser({
        userId: payload.userId,
        email: payload.email,
        role: payload.role || null,
      });
      currentSession = { user: currentUser, access_token: token };
    }
  } catch {
    // Ignore
  }
};

loadSession();

const markBackendReachableFromResponse = () => {
  resetBackendReachable();
};

const markBackendReachableFromAxiosError = (error: any) => {
  if (error?.response) {
    resetBackendReachable();
  }
};

class MutationBuilder {
  private table: string;
  private action: 'insert' | 'update' | 'delete' | 'upsert';
  private payload: any;
  private q: QueryState;
  private options: Record<string, any>;

  constructor(
    table: string,
    action: 'insert' | 'update' | 'delete' | 'upsert',
    payload: any,
    query: QueryState,
    options: Record<string, any> = {}
  ) {
    this.table = table;
    this.action = action;
    this.payload = payload;
    this.q = cloneQueryState(query);
    this.options = { ...options };
  }

  select(query: string = '*') {
    this.q.select = query;
    return this;
  }

  eq(column: string, value: any) {
    this.q.eq[column] = value;
    return this;
  }

  in(column: string, values: any[]) {
    this.q.in[column] = values;
    return this;
  }

  gte(column: string, value: any) {
    this.q.gte[column] = value;
    return this;
  }

  lte(column: string, value: any) {
    this.q.lte[column] = value;
    return this;
  }

  gt(column: string, value: any) {
    this.q.gt[column] = value;
    return this;
  }

  lt(column: string, value: any) {
    this.q.lt[column] = value;
    return this;
  }

  is(column: string, value: any) {
    this.q.is[column] = value;
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.q.order[column] = options;
    return this;
  }

  limit(value: number) {
    this.q.limit = value;
    return this;
  }

  single() {
    this.q.single = true;
    return this;
  }

  maybeSingle() {
    this.q.single = true;
    return this;
  }

  async execute() {
    try {
      const res = await axios.post(
        `${API_URL}/api/query`,
        {
          table: this.table,
          action: this.action,
          data: this.payload,
          query: this.q,
          options: this.options,
        },
        {
          headers: getAuthHeaders(),
        }
      );
      markBackendReachableFromResponse();
      return {
        data: normalizeResultData(res.data.data, this.q.single),
        error: null,
      };
    } catch (err: any) {
      markBackendReachableFromAxiosError(err);
      return { data: null, error: err.response?.data?.error || err };
    }
  }

  then(resolve: any, reject: any) {
    return this.execute().then(resolve, reject) as any;
  }
}

class QueryBuilder {
  private table: string;
  private q: QueryState = createInitialQueryState();

  constructor(table: string) {
    this.table = table;
  }

  select(query: string = '*') {
    this.q.select = query;
    return this;
  }

  eq(column: string, value: any) {
    this.q.eq[column] = value;
    return this;
  }

  in(column: string, values: any[]) {
    this.q.in[column] = values;
    return this;
  }

  gte(column: string, value: any) {
    this.q.gte[column] = value;
    return this;
  }

  lte(column: string, value: any) {
    this.q.lte[column] = value;
    return this;
  }

  gt(column: string, value: any) {
    this.q.gt[column] = value;
    return this;
  }

  lt(column: string, value: any) {
    this.q.lt[column] = value;
    return this;
  }

  is(column: string, value: any) {
    this.q.is[column] = value;
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.q.order[column] = options;
    return this;
  }

  limit(value: number) {
    this.q.limit = value;
    return this;
  }

  single() {
    this.q.single = true;
    return this;
  }

  maybeSingle() {
    this.q.single = true;
    return this;
  }

  insert(data: any | any[]) {
    return new MutationBuilder(this.table, 'insert', data, createInitialQueryState());
  }

  update(data: any) {
    return new MutationBuilder(this.table, 'update', data, this.q);
  }

  delete() {
    return new MutationBuilder(this.table, 'delete', null, this.q);
  }

  upsert(data: any | any[], options: Record<string, any> = {}) {
    return new MutationBuilder(this.table, 'upsert', data, createInitialQueryState(), options);
  }

  private async executeSelect() {
    try {
      const res = await axios.post(
        `${API_URL}/api/query`,
        {
          table: this.table,
          action: 'select',
          query: this.q,
        },
        {
          headers: getAuthHeaders(),
        }
      );
      markBackendReachableFromResponse();
      return {
        data: normalizeResultData(res.data.data, this.q.single),
        error: null,
      };
    } catch (err: any) {
      markBackendReachableFromAxiosError(err);
      return { data: null, error: err.response?.data?.error || err };
    }
  }

  then(resolve: any, reject: any) {
    return this.executeSelect().then(resolve, reject);
  }
}

export const apiClient = {
  from: (table: string) => new QueryBuilder(table),
  rpc: async (functionName: string, args: any = {}) => {
    try {
      const res = await axios.post(`${API_URL}/api/rpc/${functionName}`, args, {
        headers: getAuthHeaders(),
      });
      markBackendReachableFromResponse();
      return { data: res.data.data, error: null };
    } catch (err: any) {
      markBackendReachableFromAxiosError(err);
      return { data: null, error: err.response?.data?.error || err };
    }
  },
  auth: {
    signUp: async ({
      email,
      password,
      options,
    }: {
      email: string;
      password: string;
      options?: { data?: Record<string, any>; emailRedirectTo?: string };
    }) => {
      try {
        const res = await axios.post(`${API_URL}/api/auth/signup`, { email, password, options });
        const { user, token } = res.data.data;
        markBackendReachableFromResponse();
        localStorage.setItem('token', token);
        currentUser = user;
        currentSession = { user, access_token: token };
        authListeners.forEach(listener => listener('SIGNED_IN', currentSession));
        return { data: { user, session: currentSession }, error: null };
      } catch (err: any) {
        markBackendReachableFromAxiosError(err);
        return { data: null, error: err.response?.data?.error || err };
      }
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      try {
        const res = await axios.post(`${API_URL}/api/auth/signin`, { email, password });
        const { user, token } = res.data.data;
        markBackendReachableFromResponse();
        localStorage.setItem('token', token);
        currentUser = user;
        currentSession = { user, access_token: token };
        authListeners.forEach(listener => listener('SIGNED_IN', currentSession));
        return { data: { user, session: currentSession }, error: null };
      } catch (err: any) {
        markBackendReachableFromAxiosError(err);
        return { data: null, error: err.response?.data?.error || err };
      }
    },
    signOut: async (_opts?: { scope?: string }) => {
      localStorage.removeItem('token');
      currentSession = null;
      currentUser = null;
      authListeners.forEach(listener => listener('SIGNED_OUT', null));
      return { data: null, error: null };
    },
    getUser: async () => {
      if (currentUser) {
        return { data: { user: currentUser }, error: null };
      }
      return { data: { user: null }, error: null };
    },
    getSession: async () => {
      return { data: { session: currentSession }, error: null };
    },
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      authListeners.push(callback);
      if (currentSession) {
        callback('SIGNED_IN', currentSession);
      } else {
        callback('SIGNED_OUT', null);
      }
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              authListeners = authListeners.filter(l => l !== callback);
            }
          }
        }
      };
    },
    startAutoRefresh: async () => {},
    stopAutoRefresh: async () => {},
  },
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: Blob) => {
        try {
          const publicUrl = await readBlobAsDataUrl(file);
          writeStorageObject(bucket, path, publicUrl);
          return { data: { path }, error: null };
        } catch (error: any) {
          return { data: null, error };
        }
      },
      getPublicUrl: (path: string) => {
        const storedObject = readStorageObject(bucket, path);
        return {
          data: {
            publicUrl: storedObject?.publicUrl || `${API_URL}/storage/${bucket}/${path}`,
          },
        };
      },
      remove: async (paths: string[]) => {
        try {
          for (const path of paths) {
            removeStorageObject(bucket, path);
          }
          return { data: paths, error: null };
        } catch (error: any) {
          return { data: null, error };
        }
      },
    })
  },
  channel: (_name: string) => ({
    on: (_event: string, _filter: any, _callback: (...args: any[]) => void) => ({
      subscribe: () => ({ _stub: true }),
    }),
  }),
  removeChannel: (_channel: any) => {},
  removeAllChannels: async () => {}
};

let isBackendReachable = true;
let isRealtimeReachable = true;

export const getIsBackendReachable = () => isBackendReachable;
export const getIsRealtimeReachable = () => isRealtimeReachable;

export const setBackendUnreachable = () => { isBackendReachable = false; };
export const resetBackendReachable = () => { isBackendReachable = true; };
export const setRealtimeUnreachable = () => { isRealtimeReachable = false; };
export const resetRealtimeReachable = () => { isRealtimeReachable = true; };

export function canUseApiClientSync() {
  return typeof navigator !== 'undefined' && navigator.onLine && isBackendReachable;
}

export function canUseRealtime() {
  return canUseApiClientSync() && isRealtimeReachable;
}

// Replacement for the old isBackendTransientError.
// Detects network-level failures (backend unreachable) vs normal app errors.
export function isBackendTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as any;

  if (err.isAxiosError && !err.response) return true;
  if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED') return true;
  if (typeof err.message === 'string' && /network error|failed to fetch/i.test(err.message)) return true;

  return false;
}

export async function safeApiClientCall<T>(call: Promise<{ data: T | null; error: any }>): Promise<T | null> {
  if (!isBackendReachable) return null;
  try {
    const { data, error } = await call;
    if (error) {
      if (isBackendTransientError(error)) {
        setBackendUnreachable();
      } else {
        resetBackendReachable();
      }
      console.error('API Error:', error);
      return null;
    }
    resetBackendReachable();
    return data;
  } catch (err) {
    if (isBackendTransientError(err)) {
      setBackendUnreachable();
    } else {
      resetBackendReachable();
    }
    console.error('API Call failed:', err);
    return null;
  }
}

export function clearPersistedSession() {
  localStorage.removeItem('token');
  currentSession = null;
  currentUser = null;
}
// Wraps a call with a timeout so a hung request doesn't block forever.
// Equivalent of the old withApiTimeout.
export async function withApiTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 8000
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
    ),
  ]);
}
