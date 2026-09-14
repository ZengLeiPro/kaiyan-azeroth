import { configureEntityRendererLoader } from '@/components/patterns/drawer-stack/entity-registry';

/**
 * CRM composition root for drawer entity renderers.
 *
 * App installs the loader eagerly, while the eight business field modules stay behind one dynamic
 * import. The generic drawer stack therefore knows nothing about pages and non-CRM users do not pay
 * the renderer bundle cost until an entity drawer is opened.
 */
const loadCrmDrawerEntities = () => import('./register-drawer-entities');

export function bootstrapCrmDrawerEntities(): void {
  configureEntityRendererLoader(loadCrmDrawerEntities);
}
