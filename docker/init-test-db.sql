-- 创建 E2E 测试数据库（仅在首次初始化时执行）
-- docker-entrypoint-initdb.d 脚本只在数据卷为空时运行
SELECT 'CREATE DATABASE "ky-azeroth-test"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ky-azeroth-test')\gexec
