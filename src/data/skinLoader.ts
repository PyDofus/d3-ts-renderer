import type {SkinBundle} from './types.js';
import {loader} from './loader.js';

export async function getSkin(skinId: number): Promise<SkinBundle> {
    return loader.loadSkin(skinId);
}
