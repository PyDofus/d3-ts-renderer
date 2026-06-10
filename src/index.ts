export {Look, type LookDict} from './look/look';
export {SubEntityCategory} from './look/enums';
export type {RGB} from './look/colorUtilities';
export {intToRgb, rgbToInt, indexedColorsToDict, mergeIndexedColors, indexedColorIndices, riderToMountIndex} from './look/colorUtilities';

export {Directions, oppositeDirection} from './data/directions';
export {getAnimName, directionsByAnim} from './data/animation';

export {configure, getLoader, createDataLoader} from './data/loader';
export type {DataLoader, DataConfig, ImageDecoder} from './data/loader';
export type {TextureSource, RawImageData} from './data/types';

export {DofusSprite, LookChange} from './renderer/dofusSprite';

export {SpriteAudioPlayer} from './browser/audio';
export {getAudioManager, AudioManager} from './data/audio';
export type {SoundEvent} from './data/audio';

export {saveToPng, saveToWebp, saveToWebm, encodeCurrentFrame} from './browser/export';
export type {SaveWebpBrowserOptions, SaveWebmBrowserOptions} from './browser/export';

export {SpritePlayback} from './browser/playback';
export type {SpritePlayOptions} from './browser/playback';
