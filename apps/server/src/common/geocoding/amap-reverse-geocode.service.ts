import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const AMAP_REVERSE_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/regeo';
const REQUEST_TIMEOUT_MS = 3000;
const REQUEST_ATTEMPTS = 2;

interface Coordinate {
  lng: number;
  lat: number;
}

interface AmapReverseGeocodeResponse {
  status?: string;
  info?: string;
  infocode?: string;
  regeocode?: {
    formatted_address?: string;
  };
}

export interface ResolvedVisitLocation {
  signAddress: string | null;
  signLocation: string | null;
}

@Injectable()
export class AmapReverseGeocodeService {
  private readonly logger = new Logger(AmapReverseGeocodeService.name);

  constructor(private readonly config: ConfigService) {}

  async ensureAddress(
    signAddress: string | null | undefined,
    signLocation: string | null | undefined
  ): Promise<ResolvedVisitLocation> {
    const address = signAddress?.trim() || null;
    const locationText = signLocation?.trim() || null;
    const explicitCoordinate = locationText ? parseLngLat(locationText) : null;

    if (locationText && !explicitCoordinate) {
      throw new BadRequestException('签到坐标格式无效，请重新定位');
    }

    const coordinateOnly = isCoordinateOnlyAddress(address);
    if (address && !coordinateOnly) {
      return {
        signAddress: address,
        signLocation: explicitCoordinate ? formatCoordinate(explicitCoordinate) : null,
      };
    }

    let coordinate = explicitCoordinate;
    if (!coordinate && address) {
      const wgs84Coordinate = parseLabeledWgs84(address);
      if (wgs84Coordinate) {
        coordinate = wgs84ToGcj02(wgs84Coordinate);
      } else {
        coordinate = parseLngLat(address);
      }
    }

    if (!coordinate) {
      if (address) {
        throw new BadRequestException('签到坐标格式无效，请重新定位');
      }
      return { signAddress: null, signLocation: null };
    }

    const normalizedLocation = formatCoordinate(coordinate);
    const resolvedAddress = await this.reverseGeocode(normalizedLocation);
    return { signAddress: resolvedAddress, signLocation: normalizedLocation };
  }

  private async reverseGeocode(location: string): Promise<string> {
    const key = this.config.get<string>('AMAP_WEB_SERVICE_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException('签到地址服务未配置，请联系管理员');
    }

    const url = new URL(AMAP_REVERSE_GEOCODE_URL);
    url.searchParams.set('key', key);
    url.searchParams.set('location', location);
    url.searchParams.set('radius', '1000');
    url.searchParams.set('extensions', 'base');
    url.searchParams.set('output', 'json');

    let lastError = '未知错误';
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }

        const payload = (await response.json()) as AmapReverseGeocodeResponse;
        const rawAddress = payload.regeocode?.formatted_address;
        const formattedAddress = typeof rawAddress === 'string' ? rawAddress.trim() : '';
        if (payload.status === '1' && formattedAddress) {
          return formattedAddress;
        }
        lastError = `${payload.info ?? '高德未返回地址'} (${payload.infocode ?? '无错误码'})`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    this.logger.warn(`高德逆地理编码失败：${lastError}`);
    throw new ServiceUnavailableException(
      '签到地址解析失败，请重新定位后再提交；也可以手动填写详细地址'
    );
  }
}

function isCoordinateOnlyAddress(address: string | null): boolean {
  if (!address) return false;
  return Boolean(parseLabeledWgs84(address) ?? parseLngLat(address));
}

function parseLabeledWgs84(value: string): Coordinate | null {
  const match = value.match(
    /^\s*纬度\s*([-+]?\d+(?:\.\d+)?)\s*[,，]\s*经度\s*([-+]?\d+(?:\.\d+)?)(?:\s*\([^)]*\))?\s*$/
  );
  if (!match) return null;
  return validCoordinate(Number(match[2]), Number(match[1]));
}

function parseLngLat(value: string): Coordinate | null {
  const match = value.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*[,，]\s*([-+]?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  return validCoordinate(Number(match[1]), Number(match[2]));
}

function validCoordinate(lng: number, lat: number): Coordinate | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { lng, lat };
}

function formatCoordinate(coordinate: Coordinate): string {
  return `${coordinate.lng.toFixed(6)},${coordinate.lat.toFixed(6)}`;
}

function wgs84ToGcj02(coordinate: Coordinate): Coordinate {
  const { lng, lat } = coordinate;
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
    return coordinate;
  }

  const a = 6378245.0;
  const ee = 0.006693421622965943;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

function transformLat(x: number, y: number): number {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  value += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  value += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return value;
}

function transformLng(x: number, y: number): number {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  value += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  value += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return value;
}
