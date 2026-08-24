import { loadRepositoryEnvironment } from "./load-repository-environment.js";
import {
  parsePlatformConfig,
  type PlatformConfig,
} from "./platform-config.js";

export function loadPlatformConfig(): PlatformConfig {
  loadRepositoryEnvironment();
  return parsePlatformConfig(process.env);
}
