import type {SkinBundle} from './types';
import {getLoader} from './loader';

export async function getSkin(skinId: number): Promise<SkinBundle> {
    return getLoader().loadSkin(skinId);
}