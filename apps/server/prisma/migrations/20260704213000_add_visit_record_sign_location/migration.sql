-- 拜访记录：新增 signLocation 字段（原始 GPS 坐标 "lng,lat"）
-- 用途：前端签到时经高德反解填 signAddress（人类地址）+ signLocation（原坐标），
-- 用于高德地图跳转链接与未来距离分析。历史数据 signAddress 里是坐标字符串，
-- signLocation 会为 NULL——渲染时不显示跳转链接。
ALTER TABLE "visit_records" ADD COLUMN "signLocation" TEXT;
