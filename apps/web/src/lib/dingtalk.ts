import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const DINGTALK_LOGIN_STATE_KEY = 'ky-azeroth-dingtalk-login-state';
const DINGTALK_LOGIN_REDIRECT_PREFIX = 'ky-azeroth-dingtalk-login-redirect:';
const DINGTALK_SCRIPT_URL = 'https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js';

declare global {
  interface Window {
    dd?: {
      env?: { platform?: string };
      ready?: (callback: () => void) => void;
      error?: (callback: (error: unknown) => void) => void;
      runtime?: {
        permission?: {
          requestAuthCode?: (options: {
            corpId?: string;
            onSuccess: (result: { code: string }) => void;
            onFail: (error: unknown) => void;
          }) => void;
        };
      };
      requestAuthCode?: (options: {
        corpId?: string;
        clientId: string;
        onSuccess: (result: { code: string }) => void;
        onFail: (error: unknown) => void;
      }) => void;
    };
    DTFrameLogin?: (
      frameParams: { id: string; width?: number; height?: number },
      loginParams: {
        redirect_uri: string;
        client_id: string;
        scope: string;
        state: string;
        prompt: string;
      },
      successCbk: (result: { redirectUrl?: string }) => void,
      errorCbk?: (errorMsg: string) => void
    ) => void;
  }
}

export function getDingtalkConfig() {
  const clientId = import.meta.env.VITE_DINGTALK_CLIENT_ID || 'ding90ly48101aohqago';
  const webClientId = import.meta.env.VITE_DINGTALK_WEB_CLIENT_ID || clientId;
  return {
    clientId,
    webClientId,
    corpId: import.meta.env.VITE_DINGTALK_CORP_ID,
  };
}

export function isDingtalkInApp() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('dingtalk') || Boolean(window.dd?.env?.platform);
}

export async function finishDingtalkLogin(code: string, source: 'in_app' | 'web', state?: string) {
  const response = await api.post('/auth/dingtalk-login', { code, source, state });
  const { accessToken, refreshToken, expiresIn, user } = response.data;
  const { setTokens, setUser } = useAuthStore.getState();
  setTokens(accessToken, refreshToken, expiresIn);
  setUser(user);
}

export async function requestDingtalkInAppCode() {
  const { clientId, corpId } = getDingtalkConfig();
  if (!clientId) throw new Error('缺少钉钉 Client ID');

  const dd = await loadDingtalkJsApi();
  await waitDingtalkReady(dd);

  const requestAuthCode = dd.runtime?.permission?.requestAuthCode;
  if (requestAuthCode) {
    return new Promise<string>((resolve, reject) => {
      requestAuthCode({
        corpId,
        onSuccess: (result) => resolve(result.code),
        onFail: (error) => reject(new Error(formatDingtalkAuthError(error))),
      });
    });
  }

  if (!dd.requestAuthCode) throw new Error('当前环境不支持钉钉免登');
  return new Promise<string>((resolve, reject) => {
    dd.requestAuthCode?.({
      corpId,
      clientId,
      onSuccess: (result) => resolve(result.code),
      onFail: (error) => reject(new Error(formatDingtalkAuthError(error))),
    });
  });
}

function saveDingtalkRedirect(state: string, redirectPath?: string) {
  if (redirectPath) {
    sessionStorage.setItem(`${DINGTALK_LOGIN_REDIRECT_PREFIX}${state}`, redirectPath);
  }
}

export function buildDingtalkLoginUrl(redirectPath?: string) {
  const { webClientId } = getDingtalkConfig();
  const state = crypto.randomUUID();
  sessionStorage.setItem(DINGTALK_LOGIN_STATE_KEY, state);
  saveDingtalkRedirect(state, redirectPath);

  const redirectUri = `${window.location.origin}/login`;
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: 'code',
    client_id: webClientId,
    scope: 'openid corpid',
    state,
    prompt: 'consent',
  });
  return `https://login.dingtalk.com/oauth2/auth?${params.toString()}`;
}

export function getDingtalkCallbackFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('authCode') || params.get('code');
  const state = params.get('state') || undefined;
  if (!code) return null;

  const savedState = sessionStorage.getItem(DINGTALK_LOGIN_STATE_KEY);
  if (savedState && state && savedState !== state) {
    throw new Error('钉钉登录 state 校验失败，请重新登录');
  }
  sessionStorage.removeItem(DINGTALK_LOGIN_STATE_KEY);
  const redirectKey = state ? `${DINGTALK_LOGIN_REDIRECT_PREFIX}${state}` : undefined;
  const redirectPath = redirectKey ? sessionStorage.getItem(redirectKey) : null;
  if (redirectKey) sessionStorage.removeItem(redirectKey);
  return { code, state, redirectPath };
}

export async function renderDingtalkQrLogin(containerId: string, redirectPath?: string) {
  await loadDingtalkQrScript();
  const { webClientId } = getDingtalkConfig();
  const state = crypto.randomUUID();
  sessionStorage.setItem(DINGTALK_LOGIN_STATE_KEY, state);
  saveDingtalkRedirect(state, redirectPath);

  window.DTFrameLogin?.(
    { id: containerId, width: 300, height: 300 },
    {
      redirect_uri: encodeURIComponent(`${window.location.origin}/login`),
      client_id: webClientId,
      scope: 'openid corpid',
      state,
      prompt: 'consent',
    },
    (result) => {
      if (result.redirectUrl) window.location.href = result.redirectUrl;
    }
  );
}

function loadDingtalkJsApi() {
  if (window.dd) return Promise.resolve(window.dd);
  return loadScript('https://g.alicdn.com/dingding/open-develop/1.9.0/dingtalk.js').then(() => {
    if (!window.dd) throw new Error('钉钉 JSAPI 加载失败');
    return window.dd;
  });
}

function waitDingtalkReady(dd: NonNullable<Window['dd']>) {
  if (!dd.ready) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    dd.error?.((error) => reject(new Error(formatDingtalkAuthError(error))));
    dd.ready?.(() => resolve());
  });
}

function formatDingtalkAuthError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const data = error as Record<string, unknown>;
    const message = data.errorMessage || data.errMsg || data.message || data.error;
    const code = data.errorCode || data.errCode || data.code;
    if (message && code) return `${message}（${code}）`;
    if (message) return String(message);
    if (code) return String(code);
    return JSON.stringify(data);
  }
  return '钉钉免登失败';
}

function loadDingtalkQrScript() {
  if (window.DTFrameLogin) return Promise.resolve();
  return loadScript(DINGTALK_SCRIPT_URL, '钉钉扫码组件加载失败');
}

function loadScript(src: string, errorMessage = '脚本加载失败') {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(errorMessage)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(errorMessage));
    document.head.appendChild(script);
  });
}
