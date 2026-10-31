import { BadRequestException, Body, Controller, ForbiddenException, Header, HttpCode, Injectable, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { Session, UserGuard } from './auth';
import { User } from './entities';

type CityLocation = { city: string; region: [string, string, string] };
const GEOCODER_PATH = '/ws/geocoder/v1/';
const LOCATION_TIMEOUT_MS = 5_000;
const FALLBACK_MESSAGE = '自动定位暂不可用，请手动选择城市';
const municipalityNames = ['北京', '天津', '上海', '重庆'];
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function cityLocationFromResult(value: unknown): CityLocation {
  const result = record(value), component = record(result.address_component), administrative = record(result.ad_info);
  let province = text(component.province), officialCity = text(component.city);
  const adcode = String(administrative.adcode || '');
  const directCountyCode = /^(4190|4290|4690|6590)\d{2}$/.test(adcode);
  let countyCategory = /^(省|自治区)直辖/.test(officialCity) || directCountyCode
    ? (officialCity.startsWith('自治区直辖') || adcode.startsWith('6590') ? '自治区直辖县级行政区划' : '省直辖县级行政区划') : '';
  const administrativeCity = text(administrative.city);
  if ((!officialCity || /^(省|自治区)直辖/.test(officialCity)) && administrativeCity && !/^(省|自治区)直辖/.test(administrativeCity)) officialCity = administrativeCity;
  const provinceShortName = province.replace(/市$/, '');
  if (municipalityNames.includes(provinceShortName)) { province = officialCity = `${provinceShortName}市`; countyCategory = ''; }
  if (['香港', '香港特别行政区'].includes(province)) { province = officialCity = '香港特别行政区'; countyCategory = ''; }
  if (['澳门', '澳门特别行政区'].includes(province)) { province = officialCity = '澳门特别行政区'; countyCategory = ''; }
  // A directly administered county is the public city itself; do not return anything more precise.
  if (/^(省|自治区)直辖/.test(officialCity) || (!officialCity && directCountyCode)) officialCity = text(component.district);
  const city = province === '香港特别行政区' ? '香港' : province === '澳门特别行政区' ? '澳门' : officialCity.replace(/市$/, '');
  if (!province || !city || province.length > 50 || city.length > 50 || /^(省|自治区)直辖/.test(city)) throw new ServiceUnavailableException('暂无法识别所在城市，请手动选择城市');
  return { city, region: countyCategory ? [province, countyCategory, officialCity] : [province, officialCity, ''] };
}

@Injectable()
export class CityLocationService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async locateCity(session: Session, body: unknown): Promise<CityLocation> {
    const input = record(body), latitude = input.latitude, longitude = input.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new BadRequestException('定位坐标无效，请重新定位或手动选择城市');
    if (!await this.users.existsBy({ id: session.id, status: 'active' })) throw new ForbiddenException('账号不可用');
    const key = process.env.TENCENT_MAP_KEY?.trim();
    if (!key) throw new ServiceUnavailableException('自动定位尚未配置，请手动选择城市');
    const parameters: Record<string, string> = { get_poi: '0', key, location: `${latitude},${longitude}` };
    const secret = process.env.TENCENT_MAP_SECRET?.trim();
    if (secret) {
      // Tencent signs the sorted, unencoded values; encode only the final outgoing query.
      const unsignedQuery = Object.keys(parameters).sort().map((name) => `${name}=${parameters[name]}`).join('&');
      parameters.sig = createHash('md5').update(`${GEOCODER_PATH}?${unsignedQuery}${secret}`).digest('hex');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCATION_TIMEOUT_MS);
    try {
      const response = await fetch(`https://apis.map.qq.com${GEOCODER_PATH}?${new URLSearchParams(parameters)}`, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new ServiceUnavailableException(FALLBACK_MESSAGE);
      const data = record(await response.json());
      if (data.status !== 0) throw new ServiceUnavailableException(FALLBACK_MESSAGE);
      return cityLocationFromResult(data.result);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      // Do not expose or log upstream URLs, credentials, coordinates, or addresses.
      throw new ServiceUnavailableException(controller.signal.aborted ? '定位服务响应超时，请手动选择城市' : FALLBACK_MESSAGE);
    } finally {
      clearTimeout(timeout);
    }
  }
}

@Controller('api/v1/location')
export class CityLocationController {
  constructor(private readonly service: CityLocationService) {}

  @UseGuards(UserGuard)
  @Post('city')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  city(@Req() request: { user: Session }, @Body() body: unknown) { return this.service.locateCity(request.user, body); }
}
