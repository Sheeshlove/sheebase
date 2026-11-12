export {
  ACTIONS,
  type Action,
  can,
  isReadOnly,
  type PermissionContext,
  type Role,
  ROLES,
} from './permissions';
export { EnvError, envSchema, loadEnv, type Env } from './env';

/** Название продукта в интерфейсе — всегда прописными, кириллицей. */
export const PRODUCT_NAME = 'ШИБЕЙС';
