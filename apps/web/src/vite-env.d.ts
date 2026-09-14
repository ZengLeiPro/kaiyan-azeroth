/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DINGTALK_CLIENT_ID?: string;
  readonly VITE_DINGTALK_WEB_CLIENT_ID?: string;
  readonly VITE_DINGTALK_CORP_ID?: string;
  /** 高德 Web 端 JS API Key（域名白名单：azeroth.example.com + localhost） */
  readonly VITE_AMAP_WEB_KEY?: string;
  /** 高德 JS API 安全密钥 securityJsCode（内联前端，非机密） */
  readonly VITE_AMAP_SECURITY_JSCODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
