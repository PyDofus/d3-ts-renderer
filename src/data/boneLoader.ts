import {BinaryReader} from '../readers/binaryReader';
import {AnimationInstance} from '../readers/animationInstance';
import type {Animation, BoneBundle} from './types';
import {loader} from './loader';


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
