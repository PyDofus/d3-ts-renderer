import { FsLoader } from './fsLoader';
import { createDataLoader as createBrowserDataLoader, setLoader, toLoaderOptions } from '../data/loader';
import type { DataConfig, DataLoader } from '../data/loader';

export * from '../index';
export { FsLoader };
export { decodeImage, createCanvas, saveToPng, saveAnimation } from './export';
export type { SaveAnimationOptions } from './export';

export function createDataLoader(config: DataConfig): DataLoader {
    if (config.strategy === 'fs') {
        return new FsLoader(config.basePath, config.ImageExtension, config.decodeImage, toLoaderOptions(config));
    }
    return createBrowserDataLoader(config);
}

export function configure(config: DataConfig): DataLoader {
    return setLoader(createDataLoader(config));
}
