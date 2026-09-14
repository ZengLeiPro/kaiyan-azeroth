/**
 * 高德 Web 端 JS API 逆地理编码封装。
 *
 * 用途：拜访/回访签到时把浏览器 `navigator.geolocation` 拿到的 (lng, lat) 坐标
 * 反解为人类可读地址（例如「某省某市某区某路1号」）。
 *
 * ⚠️ 中国大陆坐标偏移：`navigator.geolocation` 返回 WGS-84（GPS 原始坐标系），
 * 高德 / 腾讯 / 钉钉都用 GCJ-02（国测局加密坐标系），直接送 WGS-84 会有
 * 100–500 米偏移。所有对外调用（Geocoder 反解 / signLocation 存库 / 地图跳转链接）
 * 都基于转换后的 GCJ-02 坐标，境外坐标不偏移直接透传。
 *
 * 三层兜底：
 * 1. 未配 `VITE_AMAP_WEB_KEY` → 返回 null（调用侧 fallback 到坐标字符串）
 * 2. SDK 加载失败/超时 → 返回 null
 * 3. 反解失败/无结果 → 返回 null
 *
 * SDK 通过 `webapi.amap.com/maps` 动态加载，含 `AMap.Geocoder` 插件。
 * securityJsCode 内联 `window._AMapSecurityConfig`（高德 2021 起要求，无该配置反解会报错）。
 * 域名白名单在高德控制台按安装者自己的站点配置。
 *
 * 与 KeepRecord 共用：keep-records 回访签到未来接入时可直接复用本函数。
 */

import { logger } from '@/lib/logger';

/**
 * WGS-84 → GCJ-02 坐标转换（中国大陆境内偏移，境外原样透传）。
 *
 * 算法出处：国家测绘局 GCJ-02 加密（俗称"火星坐标"）标准公式，公开可查，
 * 无版权/无第三方依赖。误差 <1 米，绰绰有余覆盖签到场景。
 */
const WGS84_A = 6378245.0;
// GCJ-02 加密常数（WGS84 椭球第一偏心率平方 e² ≈ 0.006693421622965943）
// eslint-disable-next-line no-loss-of-precision -- 标准公式常量、超出 JS Number 精度但业务只用前 15 位
const WGS84_EE = 0.00669342162296594323;

function isOutOfChina(lng: number, lat: number): boolean {
  // 中国大陆经纬度粗略包围盒；境外坐标不偏移
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02。中国大陆境内偏移 100-500m 修正，境外原样返回。
 * 精度 <1m，覆盖签到场景绰绰有余。
 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (isOutOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - WGS84_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((WGS84_A * (1 - WGS84_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((WGS84_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

// AMap 全局类型的最小声明——避免为整个 AMap 引一份 @types。
interface AMapGeocodeResult {
  regeocode?: {
    formattedAddress?: string;
  };
}

interface AMapGeocoderInstance {
  getAddress(
    location: [number, number],
    callback: (status: string, result: AMapGeocodeResult) => void
  ): void;
}

interface AMapGeocoderCtor {
  new (opts?: { radius?: number; extensions?: string }): AMapGeocoderInstance;
}

interface AMapNamespace {
  Geocoder: AMapGeocoderCtor;
}

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

const SDK_LOAD_TIMEOUT_MS = 6000;

/** SDK 加载单例——多次调用只加载一次 */
let sdkLoadPromise: Promise<AMapNamespace | null> | null = null;

function loadAMapSdk(): Promise<AMapNamespace | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.AMap) return Promise.resolve(window.AMap);

  if (sdkLoadPromise) return sdkLoadPromise;

  const key = import.meta.env.VITE_AMAP_WEB_KEY;
  if (!key) {
    // 未配 key 静默返回 null；日志给一次 hint 方便定位配置遗漏
    logger.warn(
      'Geocoding',
      'VITE_AMAP_WEB_KEY 未配置，逆地理编码不可用（将 fallback 坐标字符串）'
    );
    return Promise.resolve(null);
  }

  const secCode = import.meta.env.VITE_AMAP_SECURITY_JSCODE;
  if (secCode) {
    window._AMapSecurityConfig = { securityJsCode: secCode };
  }

  sdkLoadPromise = new Promise<AMapNamespace | null>((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`;

    const timer = window.setTimeout(() => {
      logger.warn('Geocoding', 'AMap SDK 加载超时');
      resolve(null);
    }, SDK_LOAD_TIMEOUT_MS);

    script.onload = () => {
      window.clearTimeout(timer);
      resolve(window.AMap ?? null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      logger.warn('Geocoding', 'AMap SDK 加载失败（网络/白名单/scode）');
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

function createAbortError(): DOMException {
  return new DOMException('逆地理编码已中止', 'AbortError');
}

/**
 * 只中止当前调用对共享 SDK promise 的等待，不取消或改写 SDK 单例加载。
 */
function loadAMapSdkForCall(signal?: AbortSignal): Promise<AMapNamespace | null> {
  if (!signal) return loadAMapSdk();
  if (signal.aborted) return Promise.reject(createAbortError());

  const sharedPromise = loadAMapSdk();
  return new Promise<AMapNamespace | null>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createAbortError());
    };
    const resolveCurrentCall = (AMap: AMapNamespace | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(AMap);
    };
    const rejectCurrentCall = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    // 覆盖 aborted 初检与 listener 注册之间的竞态。
    if (signal.aborted) {
      handleAbort();
      return;
    }

    void sharedPromise.then(resolveCurrentCall, rejectCurrentCall);
  });
}

export interface ReverseGeocodeInput {
  /** 经度 */
  longitude: number;
  /** 纬度 */
  latitude: number;
  /** POI 匹配半径（米），默认 500m */
  radius?: number;
  /** 调用侧会话失效时中止等待；高德回调本身不可取消，但其结果不会再被消费 */
  signal?: AbortSignal;
}

export interface ReverseGeocodeResult {
  /** 人类可读地址；反解失败为 null */
  address: string | null;
  /** 原始坐标字符串 "lng,lat"（6 位精度）——反解成功/失败都有值 */
  location: string;
}

/**
 * 反解坐标为地址。
 *
 * 输入是 WGS-84（浏览器 geolocation 原始），内部先转为 GCJ-02 再送高德——
 * 反解结果的经纬度语义、返回的 `location` 字符串、下游地图跳转链接都统一是 GCJ-02。
 *
 * @returns `{ address, location }`
 *   - `address` 反解成功则是 "福建省泉州市..."，失败为 null
 *   - `location` 始终是 6 位精度的 "lng,lat"（GCJ-02，可直接拼进 uri.amap.com/marker）
 */
export async function reverseGeocode({
  longitude,
  latitude,
  radius = 500,
  signal,
}: ReverseGeocodeInput): Promise<ReverseGeocodeResult> {
  // 中国大陆 WGS-84 → GCJ-02 偏移修正（境外原样透传，见 wgs84ToGcj02 注释）
  const [gcjLng, gcjLat] = wgs84ToGcj02(longitude, latitude);
  const location = `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`;

  const AMap = await loadAMapSdkForCall(signal);
  if (!AMap) return { address: null, location };

  return new Promise<ReverseGeocodeResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createAbortError());
    };
    const finish = (result: ReverseGeocodeResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      const geocoder = new AMap.Geocoder({ radius, extensions: 'base' });
      geocoder.getAddress([gcjLng, gcjLat], (status, result) => {
        if (status === 'complete' && result?.regeocode?.formattedAddress) {
          finish({ address: result.regeocode.formattedAddress, location });
        } else {
          finish({ address: null, location });
        }
      });
    } catch (err) {
      logger.warn('Geocoding', 'Geocoder 调用异常', err);
      finish({ address: null, location });
    }
  });
}

/**
 * 生成高德地图跨端跳转 URL（web/iOS/Android 三端通吃）。
 * 传入非法坐标 → 返回 null，调用侧不渲染链接。
 */
export function buildAmapMarkerUrl(
  signLocation: string | null | undefined,
  name?: string | null
): string | null {
  if (!signLocation) return null;
  const trimmed = signLocation.replace(/\s+/g, '');
  if (!/^[-+]?\d+(\.\d+)?,[-+]?\d+(\.\d+)?$/.test(trimmed)) return null;
  const params = new URLSearchParams({
    position: trimmed,
    name: name || '签到位置',
    src: 'azeroth',
  });
  return `https://uri.amap.com/marker?${params.toString()}`;
}
