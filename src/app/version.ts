import { version } from '../../package.json';
export const APP_VERSION = version;
export const RELEASE_LABEL = `v${version.split('.').slice(0, 2).join('.')}`;
