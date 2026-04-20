import type {SkinBundle} from './types';
import {loader} from './loader';

export async function getSkin(skinId: number): Promise<SkinBundle> {
    return loader.loadSkin(skinId);
}
