import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource, Repository } from 'typeorm';
import { createToken, Session } from '../src/auth';
import { CityLocationService } from '../src/city-location';
import { ApiErrorFilter, ResponseInterceptor } from '../src/common';
import { User } from '../src/entities';

describe('City location lookup', () => {
  let app: INestApplication, service: CityLocationService, users: Repository<User>;
  let session: Session, token: string;
  let fetchMock: jest.SpyInstance;
  const previousKey = process.env.TENCENT_MAP_KEY, previousSecret = process.env.TENCENT_MAP_SECRET;
  const coordinates = { latitude: 39.984154, longitude: 116.30749 };
  const call = (body: unknown, authorization = `Bearer ${token}`) => request(app.getHttpServer()).post('/api/v1/location/city').set('Authorization', authorization).send(body as object);
  const success = (component: object, administrative: object = {}) => new Response(JSON.stringify({
    status: 0, message: 'query ok', result: {
      address_component: component, ad_info: administrative, address: '北京市海淀区某街道1号',
      location: { lat: coordinates.latitude, lng: coordinates.longitude }, pois: [{ title: '不应返回的地点' }],
    },
  }));

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'city-location-regression-secret';
    process.env.SEED_DEMO_DATA = 'false';
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
    service = app.get(CityLocationService);
    users = app.get(DataSource).getRepository(User);
    const user = await users.save({ wechatOpenId: 'city-location-test-user' });
    session = { id: user.id, kind: 'user' };
    token = createToken(session);
  });
  beforeEach(() => {
    process.env.TENCENT_MAP_KEY = 'test-map-key';
    delete process.env.TENCENT_MAP_SECRET;
    fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unstubbed map request'));
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  afterAll(async () => {
    await app?.close();
    if (previousKey === undefined) delete process.env.TENCENT_MAP_KEY; else process.env.TENCENT_MAP_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.TENCENT_MAP_SECRET; else process.env.TENCENT_MAP_SECRET = previousSecret;
  });

  it('requires a valid user token and rejects admin, missing and disabled users before fetching', async () => {
    await call(coordinates, '').expect(401);
    await call(coordinates, 'Bearer invalid-token').expect(401);
    await call(coordinates, `Bearer ${createToken({ id: session.id, kind: 'admin' })}`).expect(401);
    await call(coordinates, `Bearer ${createToken({ id: 'missing-user', kind: 'user' })}`).expect(403);
    await users.update(session.id, { status: 'disabled' });
    try { await call(coordinates).expect(403); }
    finally { await users.update(session.id, { status: 'active' }); }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {}, { latitude: '39.9', longitude: 116.3 }, { latitude: 39.9, longitude: '116.3' },
    { latitude: null, longitude: 116.3 }, { latitude: 90.001, longitude: 116.3 },
    { latitude: -90.001, longitude: 116.3 }, { latitude: 39.9, longitude: 180.001 },
    { latitude: 39.9, longitude: -180.001 }, { latitude: [], longitude: 116.3 },
  ])('rejects invalid JSON coordinates %j without fetching', async (body) => {
    const response = await call(body).expect(400);
    expect(response.body).toMatchObject({ code: 'HTTP_400', message: expect.stringContaining('手动选择城市') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects nonfinite coordinates in the service and never reads coordinates from query parameters', async () => {
    for (const body of [{ latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity }, { latitude: -Infinity, longitude: 0 }, null, []]) {
      await expect(service.locateCity(session, body)).rejects.toThrow('定位坐标无效');
    }
    await request(app.getHttpServer()).post('/api/v1/location/city?latitude=39.9&longitude=116.3').set('Authorization', `Bearer ${token}`).send({}).expect(400);
    await request(app.getHttpServer()).get('/api/v1/location/city').set('Authorization', `Bearer ${token}`).expect(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an identifiable 503 fallback when no server key is configured', async () => {
    process.env.TENCENT_MAP_KEY = '   ';
    const response = await call(coordinates).expect(503);
    expect(response.body).toMatchObject({ code: 'HTTP_503', message: '自动定位尚未配置，请手动选择城市' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ province: '北京市', city: '北京市', district: '海淀区' }, { city: '北京', region: ['北京市', '北京市', ''] }],
    [{ province: '重庆市', city: '重庆市', district: '渝中区' }, { city: '重庆', region: ['重庆市', '重庆市', ''] }],
    [{ province: '广东省', city: '广州市', district: '天河区' }, { city: '广州', region: ['广东省', '广州市', ''] }],
    [{ province: '四川省', city: '阿坝藏族羌族自治州', district: '汶川县' }, { city: '阿坝藏族羌族自治州', region: ['四川省', '阿坝藏族羌族自治州', ''] }],
    [{ province: '香港特别行政区', city: '香港特别行政区', district: '九龙城区' }, { city: '香港', region: ['香港特别行政区', '香港特别行政区', ''] }],
    [{ province: '澳门', city: '澳门', district: '花地玛堂区' }, { city: '澳门', region: ['澳门特别行政区', '澳门特别行政区', ''] }],
    [{ province: '河南省', city: '省直辖县级行政区划', district: '济源市' }, { city: '济源', region: ['河南省', '省直辖县级行政区划', '济源市'] }],
    [{ province: '海南省', city: '文昌市', district: '文昌市' }, { city: '文昌', region: ['海南省', '文昌市', ''] }],
    [{ province: '新疆维吾尔自治区', city: '自治区直辖县级行政区划', district: '石河子市' }, { city: '石河子', region: ['新疆维吾尔自治区', '自治区直辖县级行政区划', '石河子市'] }],
  ])('returns city and a picker region without a finer district for %j', async (component, expected) => {
    fetchMock.mockResolvedValueOnce(success(component));
    const response = await call(coordinates).expect(200);
    expect(response.body.data).toEqual(expected);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain('海淀区某街道');
    expect(JSON.stringify(response.body)).not.toContain(String(coordinates.latitude));
    expect(JSON.stringify(response.body)).not.toContain('test-map-key');
    const [url, options] = fetchMock.mock.calls[0];
    const upstream = new URL(String(url));
    expect(upstream.origin + upstream.pathname).toBe('https://apis.map.qq.com/ws/geocoder/v1/');
    expect(upstream.searchParams.get('location')).toBe('39.984154,116.30749');
    expect(upstream.searchParams.get('get_poi')).toBe('0');
    expect(upstream.searchParams.has('sig')).toBe(false);
    expect(options).toMatchObject({ signal: expect.any(AbortSignal), redirect: 'error' });
  });

  it('signs the raw sorted parameters using the optional server secret', async () => {
    process.env.TENCENT_MAP_KEY = 'test-map-key';
    process.env.TENCENT_MAP_SECRET = 'test-map-secret';
    fetchMock.mockResolvedValueOnce(success({ province: '北京市', city: '北京市' }));
    await call(coordinates).expect(200);
    const upstream = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstream.searchParams.get('sig')).toBe('0bbd030df79ca6c9a9104a872634c305');
    expect(upstream.searchParams.has('secret')).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('test-map-secret');
  });

  it('uses administrative city metadata before a directly administered county fallback', async () => {
    fetchMock.mockResolvedValueOnce(success({ province: '广东省', city: '', district: '天河区' }, { city: '广州市', adcode: '440106' }));
    expect((await call(coordinates).expect(200)).body.data).toEqual({ city: '广州', region: ['广东省', '广州市', ''] });
    fetchMock.mockResolvedValueOnce(success({ province: '河南省', city: '省直辖县级行政区划', district: '济源市' }, { city: '济源市' }));
    expect((await call(coordinates).expect(200)).body.data).toEqual({ city: '济源', region: ['河南省', '省直辖县级行政区划', '济源市'] });
    fetchMock.mockResolvedValueOnce(success({ province: '海南省', city: '', district: '文昌市' }, { adcode: '469005' }));
    expect((await call(coordinates).expect(200)).body.data).toEqual({ city: '文昌', region: ['海南省', '省直辖县级行政区划', '文昌市'] });
  });

  it.each([
    ['河南省', '济源市', '419001', '省直辖县级行政区划'],
    ['湖北省', '天门市', '429006', '省直辖县级行政区划'],
    ['海南省', '文昌市', '469005', '省直辖县级行政区划'],
    ['新疆维吾尔自治区', '石河子市', 659001, '自治区直辖县级行政区划'],
  ])('keeps the native picker path for a directly administered city in %s', async (province, officialCity, adcode, category) => {
    fetchMock.mockResolvedValueOnce(success({ province, city: officialCity, district: '不应返回的更细街道' }, { adcode }));
    expect((await call(coordinates).expect(200)).body.data).toEqual({ city: String(officialCity).replace(/市$/, ''), region: [province, category, officialCity] });
  });

  it('hides upstream errors and malformed results behind a Chinese manual-selection fallback', async () => {
    const upstreamResponses = [
      new Response('unavailable', { status: 503 }), new Response(JSON.stringify({ status: 111, message: 'test-map-key secret address' })),
      new Response('malformed-json'), new Response(JSON.stringify({ status: 0 })),
      success({ province: '广东省', city: '', district: '天河区' }), success({ province: '河南省', city: '省直辖县级行政区划', district: '' }),
      success({ province: '广东省', city: '', district: '天河区' }, { adcode: '449001' }),
    ];
    for (const upstream of upstreamResponses) {
      fetchMock.mockResolvedValueOnce(upstream);
      const response = await call(coordinates).expect(503);
      expect(response.body.message).toContain('手动选择城市');
      expect(JSON.stringify(response.body)).not.toContain('test-map-key');
    }
    fetchMock.mockRejectedValueOnce(new Error('https://apis.map.qq.com?key=test-map-key&location=39.984154,116.30749'));
    const response = await call(coordinates).expect(503);
    expect(response.body.message).toBe('自动定位暂不可用，请手动选择城市');
    expect(JSON.stringify(response.body)).not.toContain('39.984154');
  });

  it('aborts the upstream request after five seconds and provides a timeout fallback', async () => {
    jest.useFakeTimers();
    jest.spyOn(users, 'existsBy').mockResolvedValue(true);
    fetchMock.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('upstream secret coordinates', 'AbortError')));
    }));
    const lookup = service.locateCity(session, coordinates);
    const assertion = expect(lookup).rejects.toThrow(new ServiceUnavailableException('定位服务响应超时，请手动选择城市'));
    await jest.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
