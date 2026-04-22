import {BinaryReader} from '../readers/binaryReader';
import {AnimationInstance} from '../readers/animationInstance';
import type {Animation, BoneBundle} from './types';
import {getLoader} from './loader';


export async function getBoneData(boneName: string, isMapAnimation?:boolean): Promise<BoneBundle> {
    const loader = getLoader();
    try {
        return await loader.loadBone(boneName, isMapAnimation);
    } catch (err) {
        if (boneName === "666") throw err;
        try {
            return await loader.loadBone("666");
        } catch {
            throw err;
        }
    }
}

export async function getAnimation(boneName: string, animation: Animation, isMapAnimation?:boolean): Promise<AnimationInstance> {
    const data = await getLoader().loadAnimationData(boneName, animation.name, isMapAnimation);
    return new AnimationInstance(new BinaryReader(data));
}
