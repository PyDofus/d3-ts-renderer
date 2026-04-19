import {BinaryReader} from '../readers/binaryReader.js';
import {AnimationInstance} from '../readers/animationInstance.js';
import type {Animation, BoneBundle} from './types.js';
import {loader} from './loader.js';


export async function getBoneData(boneName: string): Promise<BoneBundle> {
    try {
        return await loader.loadBone(boneName);
    } catch (err) {
        if (boneName === "666") throw err;
        try {
            return await loader.loadBone("666");
        } catch {
            throw err;
        }
    }
}

export async function getAnimation(boneName: string, animation: Animation): Promise<AnimationInstance> {
    const data = await loader.loadAnimationData(boneName, animation.name);
    return new AnimationInstance(new BinaryReader(data));
}
